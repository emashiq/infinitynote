import { Menu, type MenuItemConstructorOptions } from 'electron';

export function buildMenu(isPackaged: boolean): Menu {
  const view: MenuItemConstructorOptions[] = isPackaged
    ? []
    : [{ role: 'reload' }, { role: 'toggleDevTools' }];
  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'quit' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];
  if (view.length > 0) template.push({ label: 'View', submenu: view });
  return Menu.buildFromTemplate(template);
}
