import { getPref } from "./defaults.mjs";

async function loadPref(prefElement) {
  let type = prefElement.getAttribute("type");
  let name = prefElement.dataset.preference;
  let value = await getPref(name);
  switch (type) {
    case "checkbox":
      prefElement.checked = value;
      break;
    case "text":
      prefElement.value = value;
      break;
  }
}

async function savePref(prefElement) {
  let type = prefElement.getAttribute("type");
  let name = prefElement.dataset.preference;
  switch (type) {
    case "checkbox":
      await browser.storage.local.set({[name]: !!prefElement.checked});
      break;
    case "text":
      await browser.storage.local.set({[name]: prefElement.value});
      break;
  }
}

async function loadSettings() {
  let prefElements = document.querySelectorAll("*[data-preference]");
  for (let prefElement of prefElements) {
    await loadPref(prefElement);
  }
}

async function saveSettings() {
  let prefElements = document.querySelectorAll("*[data-preference]");
  for (let prefElement of prefElements) {
    await savePref(prefElement);
  }
  await loadSettings();
}

async function load() {
  i18n.updateDocument();

  await loadSettings();

  let btn_save = document.getElementById("btn_save");
  //let btn_cancel = document.getElementById("btn_cancel");
  //btn_cancel.addEventListener("click", loadSettings);
  btn_save.addEventListener("click", saveSettings);
}

window.addEventListener("load", load);
