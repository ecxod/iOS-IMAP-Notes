function collectFolders(folder, result = []) {
  if (!folder) {
    return result;
  }
  result.push(folder);
  for (const child of folder.subFolders || []) {
    collectFolders(child, result);
  }
  return result;
}

export function findAlternateFolder(account, currentFolder) {
  const candidates = collectFolders(account?.rootFolder).filter(folder =>
    folder.id !== currentFolder?.id && !folder.isRoot && !folder.isVirtual
  );
  return candidates.find(folder => folder.type === "inbox") || candidates[0] || null;
}

export async function refreshDisplayedFolder(api, tabId) {
  const tab = await api.mailTabs.get(tabId);
  const currentFolder = tab.displayedFolder;
  if (!currentFolder?.id || !currentFolder.accountId) {
    return false;
  }

  const account = await api.accounts.get(currentFolder.accountId, true);
  const alternateFolder = findAlternateFolder(account, currentFolder);
  if (!alternateFolder) {
    return false;
  }

  let switched = false;
  try {
    await api.mailTabs.update(tabId, { displayedFolder: alternateFolder });
    switched = true;
  } finally {
    if (switched) {
      await api.mailTabs.update(tabId, { displayedFolder: currentFolder });
    }
  }
  return true;
}
