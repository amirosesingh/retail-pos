function containsDrawerPulse(bytes) {
  const values = Array.from(bytes ?? []);
  for (let index = 0; index < values.length; index++) {
    if (values[index] === 0x1d && values[index + 1] === 0x76 && values[index + 2] === 0x30 &&
        [0,1,2,3,48,49,50,51].includes(values[index + 3]) && index + 8 <= values.length) {
      const width = values[index + 4] + values[index + 5] * 256;
      const height = values[index + 6] + values[index + 7] * 256;
      const end = index + 8 + width * height;
      if (width > 0 && height > 0 && end <= values.length) { index = end - 1; continue; }
    }
    if (index + 5 <= values.length && values[index] === 0x1b && values[index + 1] === 0x70 &&
        (values[index + 2] === 0 || values[index + 2] === 1)) return true;
  }
  return false;
}
module.exports = { containsDrawerPulse };
