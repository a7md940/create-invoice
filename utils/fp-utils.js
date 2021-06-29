const prop = (prop) => (obj) => obj[prop] ? obj[prop] : null;
const propEq = (prop, value) => (obj) => obj[prop] == value;
const either = (f, g) => (obj) => f(obj) || g(obj);
const filter = (predicate) => arr => arr.filter(predicate);
const pipe = (...args) => (value) => args.reduce((value, fn) => fn(value), value);
const nth = (index) => (list) => list[index] || null;

module.exports = { prop, propEq, either, filter, pipe, nth };
