// SPDX-License-Identifier: Apache-2.0

function quickPopArrayItemByIndex(array, index) {
  if (index < array.length) {
    array[index] = array[array.length - 1];
    array.pop();
  }
}

function quickPopArrayItem(array, value) {
  for (let i = 0; i < array.length; i++) {
    if (array[i] == value) {
      quickPopArrayItemByIndex(array, i);
      break;
    }
  }

  return array;
}

function compareArray(array1, array2) {
  if (array1.length != array2.length) {
    return false;
  }

  for (let i = 0; i < array1.length; i++) {
    if (array1[i] != array2[i]) {
      return false;
    }
  }

  return true;
}

module.exports = {
  quickPopArrayItem,
  compareArray,
};
