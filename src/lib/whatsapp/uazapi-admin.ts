export interface UazapiInstance {
  id: string;
  token: string;
  name: string;
  status: string;
}

export async function uazapiCreateInstance(baseUrl: string, adminToken: string, instanceName: string): Promise<UazapiInstance> {
  const url = `${baseUrl.replace(/\/$/, '')}/instance/create`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'admintoken': adminToken,
    },
    body: JSON.stringify({ 
      instanceName: instanceName,
      Name: instanceName 
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`UAZAPI create instance failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`UAZAPI error: ${data.error}`);
  }
  
  if (!data.instance || !data.instance.token) {
    throw new Error('UAZAPI response missing instance token');
  }

  return data.instance;
}

export async function uazapiSetWebhook(baseUrl: string, instanceToken: string, webhookUrl: string): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/webhook`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': instanceToken,
    },
    body: JSON.stringify({
      url: webhookUrl,
      enabled: true,
      events: ['messages', 'status']
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`UAZAPI set webhook failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`UAZAPI webhook error: ${data.error}`);
  }
}
