import { optimize } from 'svgo/browser';

/** Bundle the image bytes before leaving the document's URL space. */
export async function exportSvg(source: string, prefix: string, baseUrl: string, signal: AbortSignal): Promise<string> {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('Invalid editor SVG');
  await Promise.all([...document.querySelectorAll('image')].map(async image => {
    const href = image.getAttribute('href') ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href === null || href.startsWith('data:')) return;
    const response = await fetch(new URL(href, baseUrl), { signal });
    if (!response.ok) throw new Error(`Image export failed: ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`Invalid image type: ${blob.type}`);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    image.removeAttribute('data-image-file');
    image.setAttribute('href', data);
  }));
  return optimize(new XMLSerializer().serializeToString(document), {
    plugins: [{ name: 'prefixIds', params: { prefix } }],
  }).data;
}
