import { Montage } from './montages';

export function exportCSV(dataBuffer: number[][], timeBuffer: number[], montage: Montage) {
  if (timeBuffer.length === 0) return;

  const headers = ['Time (s)', ...montage.channels.map(c => c.label)];
  
  let csvContent = headers.join(',') + '\n';
  
  for (let i = 0; i < timeBuffer.length; i++) {
    const row = [timeBuffer[i].toFixed(4)];
    for (let c = 0; c < montage.channels.length; c++) {
      row.push(dataBuffer[c]?.[i]?.toFixed(3) ?? '');
    }
    csvContent += row.join(',') + '\n';
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `eeg-export-${new Date().toISOString()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportScreenshot(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const dataURL = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.setAttribute('href', dataURL);
  link.setAttribute('download', `eeg-screenshot-${new Date().toISOString()}.png`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
