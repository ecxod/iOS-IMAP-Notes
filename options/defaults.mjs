const PREF_DEFAULTS = {
  "putOriginalInTrash": true,
}

// We export this method, so other parts of this extension can easily access,
// options and also get the default values: If the pref has not yet been actively
// saved by the user, this function returns the default value.
export async function getPref(name) {
  let value = await browser.storage.local.get({[name]: PREF_DEFAULTS[name]});
  return value[name];
}
