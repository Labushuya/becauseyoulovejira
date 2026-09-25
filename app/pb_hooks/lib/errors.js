// Error helpers for the hooks. CommonJS module, ES5 only; uses the JSVM globals
// `BadRequestError` and `ValidationError` of PocketBase, so it runs in the Goja runtime only.
'use strict';

// 400 response with one validation error per field, like PocketBase's own field validation.
// `fields` maps field names to { code, message, params? }; `params` (plain values) reach the
// client as `data.<field>.params`, e.g. the state of a duplicate inbox item.
function validationFailure(message, fields) {
  var data = {};
  for (var name in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      var error = new ValidationError(fields[name].code, fields[name].message);
      if (fields[name].params) {
        error = error.setParams(fields[name].params);
      }
      data[name] = error;
    }
  }
  return new BadRequestError(message, data);
}

function fieldFailure(field, code, message, params) {
  var fields = {};
  fields[field] = { code: code, message: message, params: params };
  return validationFailure(message, fields);
}

module.exports = {
  validationFailure: validationFailure,
  fieldFailure: fieldFailure
};
