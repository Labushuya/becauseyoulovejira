// Error helpers for the hooks. CommonJS module, ES5 only; uses the JSVM globals
// `BadRequestError` and `ValidationError` of PocketBase, so it runs in the Goja runtime only.
'use strict';

// 400 response with one validation error per field, like PocketBase's own field validation.
// `fields` maps field names to { code, message }.
function validationFailure(message, fields) {
  var data = {};
  for (var name in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      data[name] = new ValidationError(fields[name].code, fields[name].message);
    }
  }
  return new BadRequestError(message, data);
}

function fieldFailure(field, code, message) {
  var fields = {};
  fields[field] = { code: code, message: message };
  return validationFailure(message, fields);
}

module.exports = {
  validationFailure: validationFailure,
  fieldFailure: fieldFailure
};
