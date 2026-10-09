/** Minimal {{placeholder}} rendering. Unknown placeholders render as empty. */
export function render(template, vars) {
  return String(template ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    vars[key] === undefined || vars[key] === null ? '' : String(vars[key]),
  );
}

export function templateVars(lead, config) {
  return {
    firstName: lead?.firstName || 'there',
    lastName: lead?.lastName || '',
    business: config.business.name,
    callbackNumber: config.business.callbackNumberDisplay || '',
  };
}
