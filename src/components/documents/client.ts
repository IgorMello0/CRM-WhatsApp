export async function documentRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
export async function downloadDocument(id: string, revision: number) {
  const response = await fetch(
    `/api/documents/${id}/file?revision=${revision}&download=1`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error((await response.json()).error);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download =
    response.headers
      .get('content-disposition')
      ?.match(/filename="([^"]+)"/)?.[1] ?? 'documento.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
