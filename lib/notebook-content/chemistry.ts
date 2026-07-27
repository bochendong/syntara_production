function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderChargeHtml(text: string): string {
  return text.replace(/\^([0-9]*[+-])/g, '<sup>$1</sup>');
}

function renderSubscriptsHtml(text: string): string {
  return text
    .replace(/([A-Za-z\)\]])(\d+)/g, '$1<sub>$2</sub>')
    .replace(/(\()(\d+)(?=[A-Za-z])/g, '$1$2');
}

export function chemistryTextToHtml(text: string): string {
  return renderChargeHtml(renderSubscriptsHtml(escapeHtml(text)));
}
