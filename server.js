const http = require('http');
const https = require('https');

// === CONFIGURATION ===
const VPS_HOST = 'goom.afrihall.com';
const VPS_PORT = 80;
const UUID = 'ee054fe1-9e46-4ef0-8e13-f08f031f7c20';
const VPS_IP = '178.62.247.103';
const PORT = process.env.PORT || 8080;

// Paramètres XHTTP
const XHTTP_PATH = '/';
const XHTTP_MODE = 'auto';
const XHTTP_PADDING = '100-1000';
const HOST_HEADER = 'main-bvxea6i-adurznumkcei6.fr-3.platformsh.site';
const SNI = 'main-bvxea6i-adurznumkcei6.fr-3.platformsh.site';
const ALPN = ['h2', 'http/1.1', 'h3'];
const FP = 'chrome';

const DOMAIN = process.env.DOMAIN || 'main-bvxea6i-adurznumkcei6.fr-3.platformsh.site';

// === SMOOTHING: Gentle rate limiting (does NOT block, just slows) ===
let requestTimestamps = [];
const MAX_REQUESTS_PER_WINDOW = 40;    // Gentil limit, pas 25
const WINDOW_MS = 60000;               // 1 minute

function getDelayIfNeeded() {
    const now = Date.now();
    // Garder seulement les timestamps de la dernière minute
    requestTimestamps = requestTimestamps.filter(t => now - t < WINDOW_MS);
    
    if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        const oldest = requestTimestamps[0];
        const waitTime = WINDOW_MS - (now - oldest) + 100;
        return Math.min(waitTime, 5000); // Max 5 secondes d'attente
    }
    return 0;
}

function recordRequest() {
    requestTimestamps.push(Date.now());
}

console.log('==========================================');
console.log('🚀 Bridge XHTTP SMOOTH - Upsun → VPS');
console.log(`📡 VPS cible: ${VPS_HOST}:${VPS_PORT}`);
console.log(`🔑 UUID: ${UUID}`);
console.log(`🌐 Domaine Upsun: ${DOMAIN}`);
console.log(`⏱️  Rate limit doux: ${MAX_REQUESTS_PER_WINDOW}/min`);
console.log('==========================================');

const server = http.createServer((req, res) => {
    const url = req.url;
    
    // Route principale (sans délai)
    if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`Serveur XHTTP OK\n\nStats: ${requestTimestamps.length}/${MAX_REQUESTS_PER_WINDOW} req cette minute\n\nLiens disponibles:\n- /config\n- /${UUID}\n- /${VPS_IP}\n`);
        console.log(`📄 Page d'accueil affichée`);
        return;
    }
    
    // Générer le lien VLESS (sans délai)
    if (url === `/${UUID}` || url === '/config' || url === `/${VPS_IP}`) {
        const vlessLink = `vless://${UUID}@${VPS_HOST}:${VPS_PORT}?type=xhttp&encryption=none&path=${XHTTP_PATH}&host=${HOST_HEADER}&mode=${XHTTP_MODE}&x_padding_bytes=${XHTTP_PADDING}&extra=%7B%22xPaddingBytes%22%3A%22${XHTTP_PADDING}%22%7D&security=tls&fp=${FP}&alpn=${ALPN.join('%2C')}&sni=${SNI}#XHTTP-Upsun-Bridge`;
        
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(vlessLink + '\n');
        console.log(`🔗 Lien VLESS généré (${url})`);
        return;
    }
    
    // === SMOOTHING: Petit délai si trop de requêtes ===
    const delayMs = getDelayIfNeeded();
    
    if (delayMs > 0) {
        console.log(`⏳ Ralentissement: attente ${delayMs}ms (${requestTimestamps.length}/${MAX_REQUESTS_PER_WINDOW})`);
    }
    
    setTimeout(() => {
        recordRequest();
        
        // Proxy XHTTP vers le VPS (exactement comme l'original)
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
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(`Bad Gateway: Cannot reach VPS ${VPS_HOST}:${VPS_PORT}\n`);
            }
        });
        
        req.pipe(proxyReq);
    }, delayMs);
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
