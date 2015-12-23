'use strict';

/**
 * @license
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

/**
 * @fileoverview Code to parse a CFF dict. For a detailed description of a CFF
 * dict
 * @see http://wwwimages.adobe.com/content/dam/Adobe/en/devnet/font/pdfs/5176.CFF.pdf
 * For a detailed description of the OpenType font format
 * @see http://www.microsoft.com/typography/otspec/otff.htm
 * @author bstell@google.com (Brian Stell)
 */

goog.provide('tachyfont.CffDict');

goog.require('goog.log');
goog.require('tachyfont.BinaryFontEditor');
goog.require('tachyfont.Logger');
goog.require('tachyfont.utils');



/**
 * A class holding the CFF DICT information.
 * @param {string} name The name of the DICT
 * @param {!DataView} dataView A DataView for the DICT bytes.
 * @constructor @struct @final
 */
tachyfont.CffDict = function(name, dataView) {
  /** @private {string} */
  this.name_ = name;

  /** @private {!DataView} */
  this.dataView_ = dataView;

  if (goog.DEBUG) {
    /** @private {!Array.<string>} */
    this.keys_ = [];
  }

  /**
   * Map of operator->operand.
   * @private {!Object.<string, !Array.<number>>}
   */
  this.dict_ = {};

  /**
   * The DICT operators map.
   * This is only used during debugging.
   * @dict @private {!Object.<string,string>}
   */
  this.dictOperators_;
};


/**
 * Initialize a CFF DICT.
 * @private
 */
tachyfont.CffDict.prototype.init_ = function() {
  var binEd = new tachyfont.BinaryFontEditor(this.dataView_, 0);

  while (binEd.offset < this.dataView_.byteLength) {
    var keyValuePair = tachyfont.CffDict.readOperandsOperator_(binEd);
    if (goog.DEBUG) {
      if (this.dictOperators_ && keyValuePair.key in this.dictOperators_) {
        goog.log.info(tachyfont.Logger.logger, '  ' + keyValuePair.value + ' ' +
            this.dictOperators_[keyValuePair.key]);
      } else {
        goog.log.info(tachyfont.Logger.logger, '  ' + keyValuePair.value + ' ' +
            keyValuePair.key);
      }
    }
    this.keys_.push(keyValuePair.key);
    this.dict_[keyValuePair.key] =
        /** @type {!Array.<number>} */ (keyValuePair.value);
  }
};


/**
 * Load a CFF DICT.
 * @param {string} name The name of the dict.
 * @param {!ArrayBuffer} buffer The font bytes.
 * @param {number} offset The offset in the font bytes to the DICT.
 * @param {number} length The length of the DICT.
 * @param {!Object.<string,string>=} opt_dictOperators A map of the DICT
 *     operators to the logical names.
 * @return {!tachyfont.CffDict}
 */
tachyfont.CffDict.loadDict =
    function(name, buffer, offset, length, opt_dictOperators) {
  var dataView = new DataView(buffer, offset, length);
  //tachyfont.utils.hexDump(name, dataView);
  var dict = new tachyfont.CffDict(name, dataView);
  if (goog.DEBUG) {
    dict.setOperators(opt_dictOperators);
  }
  dict.init_();
  return dict;
};


if (goog.DEBUG) {
  /**
   * For debug set the DICT operators map.
   * @param {!Object.<string,string>} dictOperators The DICT operators map.
   */
  tachyfont.CffDict.prototype.setOperators = function(dictOperators) {
    this.dictOperators_ = dictOperators;
  };
}


/**
 * Get the dict name.
 * @return {string} The Dict name.
 */
tachyfont.CffDict.prototype.getName = function() {
  return this.name_;
};


/**
 * Get the dict keys.
 * @return {!Array.<string>} The Dict keys.
 */
tachyfont.CffDict.prototype.getKeys = function() {
  return this.keys_;
};


/**
 * Get a CFF DICT value.
 * @param {string} key The key of the key/value.
 * @return {!Array.<number|string>} The Dict value for this key.
 */
tachyfont.CffDict.prototype.get = function(key) {
  if (key in this.dict_) {
    return this.dict_[key];
  }
  throw new RangeError('CFF ' + this.name_ + ' DICT: invalid key: ' + key);
};



/**
 * A class holding a key/value pair.
 * @param {string} key The key.
 * @param {*} value The value.
 * @constructor @struct @final
 * @private
 */
tachyfont.CffDict.keyValuePair_ = function(key, value) {
  /** @type {string} */
  this.key = key;

  /** @type {*} */
  this.value = value;
};


/*
 * http://wwwimages.adobe.com/content/dam/Adobe/en/devnet/font/pdfs/5176.CFF.pdf
 *
 * Table 3 Operand Encoding
 * Size   b0-range    Value-range       Value-calculation
 *   1     32-246    -107 to +107       b0-139
 *   2    247-250    +108 to +1131      (b0-247)*256+b1+108
 *   2    251-254   -1131 to -108      -(b0-251)*256-b1-108
 *   3      28     -32768 to +32767     b1<<8|b2
 *   5      29    -(2^31) to +(2^31-1)  b1<<24|b2<<16|b3<<8|b4
 *
 * Reserved operand leading bytes: 22-27, 31, and 255
 */


/**
 * Get a CFF DICT Operands/Operator set.
 * @param {!tachyfont.BinaryFontEditor} binEd The binary editor at the position
 *     of the Operands/Operator.
 * @return {!tachyfont.CffDict.keyValuePair_} The key value pair.
 * @throws {Error} If a reserved operant is found.
 * @private
 */
tachyfont.CffDict.readOperandsOperator_ = function(binEd) {
  var operands = [], operator = '';

  var operand = '', b0, b1, b2, b3, b4, op, isUndefined;
  while (operands.length <= 48) {
    // Get the operand.
    operand = isUndefined;
    b0 = binEd.getUint8();
    if ((b0 >= 22 && b0 <= 27) || b0 == 31 || b0 == 255) {
      if (goog.DEBUG) {
        goog.log.info(tachyfont.Logger.logger,
            b0 + ' is a reserved operand value');
      }
      throw new Error(tachyfont.utils.numberToHex(b0, 2) +
          'is reserved operand value');
    }
    if (b0 >= 32 && b0 <= 246) {
      operand = b0 - 139;
    } else if (b0 >= 247 && b0 <= 250) {
      b1 = binEd.getUint8();
      operand = (b0 - 247) * 256 + b1 + 108;
    } else if (b0 >= 251 && b0 <= 254) {
      b1 = binEd.getUint8();
      operand = -(b0 - 251) * 256 - b1 - 108;
    } else if (b0 == 28) {
      b1 = binEd.getUint8();
      b2 = binEd.getUint8();
      operand = b1 << 8 | b2;
    } else if (b0 == 29) {
      b1 = binEd.getUint8();
      b2 = binEd.getUint8();
      b3 = binEd.getUint8();
      b4 = binEd.getUint8();
      operand = b1 << 24 | b2 << 16 | b3 << 8 | b4;
    } else if (b0 == 30) {
      operand = tachyfont.CffDict.parseNibbles_(binEd);
    }
    if (operand !== isUndefined) {
      operands.push(operand);
      continue;
    }

    // Get the operator.
    op = b0;
    if (op == 12) {
      operator = '12 ';
      op = binEd.getUint8();
    }
    operator += op.toString();
    break;
  }
  return new tachyfont.CffDict.keyValuePair_(operator, operands);
};


/**
 * Get a CFF DICT nibble value.
 * @param {!tachyfont.BinaryFontEditor} binEd The binary editor.
 * @return {string} The nibble value.
 * @private
 */
tachyfont.CffDict.parseNibbles_ = function(binEd) {
  var operand = '', aByte, nibbles = [], nibble, operandsCnt = 0;
  while (operandsCnt++ <= 48) {
    aByte = binEd.getUint8();
    nibbles[0] = aByte >> 4;
    nibbles[1] = aByte & 0xf;
    for (var i = 0; i < 2; i++) {
      nibble = nibbles[i];
      if (nibble <= 9) {
        operand += nibble.toString();
      } else if (nibble == 0xa) {
        operand += '.';
      } else if (nibble == 0xb) {
        operand += 'E';
      } else if (nibble == 0xC) {
        operand += '-E';
      } else if (nibble == 0xe) {
        operand += '-';
      } else if (nibble == 0xf) {
        return operand;
      }
    }
  }
  return operand;
};


if (goog.DEBUG) {
  /**
   * Top DICT operator map.  This map is used to covert the operations to a
   * human readable form.
   * @dict {!Object.<string,string>}
   */
  tachyfont.CffDict.TOP_DICT_OPERATORS = {
    '0': 'version',
    '1': 'Notice',
    '12 0': 'Copyright',
    '2': 'FullName',
    '3': 'FamilyName',
    '4': 'Weight',
    '5': 'FontBBox',
    '6': 'BlueValues',
    '7': 'OtherBlue',
    '10': 'StdHW',
    '11': 'StdVW',
    '12 1': 'IsFixedPitch',
    '12 2': 'ItalicAngle',
    '12 3': 'UnderlinePosition',
    '12 4': 'UnderlineThickness',
    '12 5': 'PaintType',
    '12 6': 'CharstringType',
    '12 7': 'FontMatrix',
    '12 8': 'StrokeWidth',
    '12 12': 'StemSnapH',
    '12 13': 'StemSnapV',
    '12 17': 'LanguageGroup',
    '13': 'UniqueID',
    '14': 'XUID',
    '15': 'charset',
    '16': 'Encoding',
    '17': 'CharStrings',
    '18': 'Private',
    '19': 'Subrs',
    '20': 'DefaultWidthX',
    '21': 'NominalWidthX',
    '12 20': 'SyntheticBase',
    '12 21': 'PostScript',
    '12 22': 'BaseFontName',
    '12 23': 'BaseFontBlen',
    '12 30': 'ROS',
    '12 31': 'CIDFontVersion',
    '12 32': 'CIDFontRevision',
    '12 33': 'CIDFontType',
    '12 34': 'CIDCount',
    '12 35': 'UIDBase',
    '12 36': 'FDArray',
    '12 37': 'FDSelect',
    '12 38': 'FontName'
  };
}