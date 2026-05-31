const http = require('http');
const https = require('https');

// === NOUVELLE CONFIGURATION ===
const VPS_HOST = 'goom.afrihall.com';                // Nouveau domaine du VPS
const VPS_PORT = 80;                                    // Port du VPS
const UUID = 'ee054fe1-9e46-4ef0-8e13-f08f031f7c20';    // Nouvel UUID
const VPS_IP = '178.62.247.103';                        // Nouvelle IP
const PORT = process.env.PORT || 8080;

// Paramètres XHTTP
const XHTTP_PATH = '/';
const XHTTP_MODE = 'auto';
const XHTTP_PADDING = '100-1000';
const HOST_HEADER = 'main-bvxea6i-adurznumkcei6.fr-3.platformsh.site';  // Nouveau domaine Upsun
const SNI = 'main-bvxea6i-adurznumkcei6.fr-3.platformsh.site';
const ALPN = ['h2', 'http/1.1', 'h3'];
const FP = 'chrome';

// Domaine Upsun
const DOMAIN = process.env.DOMAIN || 'main-bvxea6i-adurznumkcei6.fr-3.platformsh.site';

console.log('==========================================');
console.log('🚀 Bridge XHTTP - Upsun → VPS');
console.log(`📡 VPS cible: ${VPS_HOST}:${VPS_PORT}`);
console.log(`🔑 UUID: ${UUID}`);
console.log(`🌐 Domaine Upsun: ${DOMAIN}`);
console.log(`🖨️  Fingerprint: ${FP}`);
console.log('==========================================');

const server = http.createServer((req, res) => {
    const url = req.url;
    
    // Route principale
    if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`Serveur XHTTP OK\n\nLiens disponibles:\n- /config\n- /${UUID}\n- /${VPS_IP}\n`);
        console.log(`📄 Page d'accueil affichée`);
        return;
    }
    
    // Générer le lien VLESS
    if (url === `/${UUID}` || url === '/config' || url === `/${VPS_IP}`) {
        const vlessLink = `vless://${UUID}@${VPS_HOST}:${VPS_PORT}?type=xhttp&encryption=none&path=${XHTTP_PATH}&host=${HOST_HEADER}&mode=${XHTTP_MODE}&x_padding_bytes=${XHTTP_PADDING}&extra=%7B%22xPaddingBytes%22%3A%22${XHTTP_PADDING}%22%7D&security=tls&fp=${FP}&alpn=${ALPN.join('%2C')}&sni=${SNI}#XHTTP-Upsun-Bridge`;
        
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(vlessLink + '\n');
        console.log(`🔗 Lien VLESS généré (${url})`);
        return;
    }
    
    // Proxy XHTTP vers le VPS
    const options = {
        hostname: VPS_HOST,
        port: VPS_PORT,
        path: url,
        method: req.method,
        headers: {
            ...req.headers,
            'host': HOST_HEADER,
            'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'accept-encoding': 'gzip, deflate',
            'connection': 'keep-alive',
            'x-padding-bytes': XHTTP_PADDING
        },
        rejectUnauthorized: false
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        console.log(`✅ Proxy: ${req.method} ${url} → ${proxyRes.statusCode}`);
    });
    
    proxyReq.on('error', (err) => {
        console.error(`❌ Erreur proxy VPS: ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Bad Gateway: Cannot reach VPS ${VPS_HOST}:${VPS_PORT}\n`);
    });
    
    req.pipe(proxyReq);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Bridge XHTTP actif sur le port ${PORT}`);
    console.log('');
    console.log(`🔗 LIENS VLESS DISPONIBLES :`);
    console.log(`   https://${DOMAIN}/config`);
    console.log(`   https://${DOMAIN}/${UUID}`);
    console.log(`   https://${DOMAIN}/${VPS_IP}`);
    console.log('');
});

server.on('error', (err) => {
    console.error(`❌ Erreur serveur: ${err.message}`);
});

process.on('SIGTERM', () => {
    console.log('🛑 Arrêt du serveur...');
    server.close(() => process.exit(0));
});
