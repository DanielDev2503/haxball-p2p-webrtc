import localtunnel from 'localtunnel';

async function start() {
  try {
    const tunnel = await localtunnel({ port: 3000 });
    console.log('TUNNEL_URL_READY:' + tunnel.url);

    tunnel.on('close', () => {
      console.log('Tunnel closed. Reconnecting in 3s...');
      setTimeout(start, 3000);
    });
    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err);
    });

    // Mantener proceso node activo
    setInterval(() => {}, 1000 * 60 * 60);
  } catch (err) {
    console.error('Error opening tunnel:', err);
    setTimeout(start, 5000);
  }
}

start();
