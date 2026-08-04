module.exports = (words) => words.map((w) => {
  return w.toLowerCase()
    .replace(/\W/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
})
.flat()
.filter((e) => e)
