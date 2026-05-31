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

// === NOUVEAUX PARAMÈTRES POUR LA SMOOTHESSE ===
const RATE_LIMIT = {
    maxRequestsPerMinute: 25,        // Limite basse pour éviter 429
    currentRequests: 0,
    lastReset: Date.now(),
    backoffDelay: 1000,               // Délai initial en ms
    maxBackoff: 30000                 // Backoff max 30 secondes
};

const CONNECTION_POOL = {
    maxSockets: 5,                    // Max connexions simultanées
    keepAlive: true,
    keepAliveMsecs: 30000
};

// Agent HTTP avec keep-alive et pooling
const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 5,
    maxFreeSockets: 3,
    timeout: 60000
});

// File d'attente des requêtes
let requestQueue = [];
let isProcessingQueue = false;
let activeRequests = 0;

console.log('==========================================');
console.log('🚀 Bridge XHTTP SMOOTH - Upsun → VPS');
console.log(`📡 VPS cible: ${VPS_HOST}:${VPS_PORT}`);
console.log(`🔑 UUID: ${UUID}`);
console.log(`⏱️  Rate limit: ${RATE_LIMIT.maxRequestsPerMinute} req/min`);
console.log(`🔗 Connexions max: ${CONNECTION_POOL.maxSockets}`);
console.log('==========================================');

// Fonction pour vérifier et mettre à jour le rate limiting
function checkRateLimit() {
    const now = Date.now();
    if (now - RATE_LIMIT.lastReset >= 60000) {
        RATE_LIMIT.currentRequests = 0;
        RATE_LIMIT.lastReset = now;
        RATE_LIMIT.backoffDelay = 1000;
    }
    
    if (RATE_LIMIT.currentRequests >= RATE_LIMIT.maxRequestsPerMinute) {
        const waitTime = 60000 - (now - RATE_LIMIT.lastReset);
        return { allowed: false, waitTime };
    }
    
    return { allowed: true, waitTime: 0 };
}

// Fonction de délai avec backoff exponentiel
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Traitement de la file d'attente
async function processQueue() {
    if (isProcessingQueue || requestQueue.length === 0) return;
    if (activeRequests >= CONNECTION_POOL.maxSockets) return;
    
    const rateCheck = checkRateLimit();
    if (!rateCheck.allowed) {
        console.log(`⏳ Rate limit atteint, attente ${Math.ceil(rateCheck.waitTime/1000)}s...`);
        setTimeout(() => processQueue(), rateCheck.waitTime);
        return;
    }
    
    isProcessingQueue = true;
    
    while (requestQueue.length > 0 && activeRequests < CONNECTION_POOL.maxSockets) {
        const { req, res, url } = requestQueue.shift();
        activeRequests++;
        RATE_LIMIT.currentRequests++;
        
        // Traiter la requête sans bloquer
        handleProxyRequest(req, res, url).finally(() => {
            activeRequests--;
            processQueue(); // Continuer avec la prochaine requête
        });
    }
    
    isProcessingQueue = false;
}

// Gestionnaire de proxy avec retry automatique
async function handleProxyRequest(req, res, url, retryCount = 0) {
    const maxRetries = 3;
    
    const options = {
        hostname: VPS_HOST,
        port: VPS_PORT,
        path: url,
        method: req.method,
        agent: httpAgent,
        headers: {
            'host': HOST_HEADER,
            'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'accept-encoding': 'gzip, deflate',
            'connection': 'keep-alive',
            'x-padding-bytes': XHTTP_PADDING,
            'x-rate-limit-safe': 'true'
        },
        timeout: 30000,
        rejectUnauthorized: false
    };
    
    // Ajouter des headers spécifiques pour éviter les timeouts
    if (req.headers['content-length']) {
        options.headers['content-length'] = req.headers['content-length'];
    }
    
    return new Promise((resolve) => {
        const proxyReq = http.request(options, (proxyRes) => {
            // Répondre immédiatement au client
            res.writeHead(proxyRes.statusCode, {
                ...proxyRes.headers,
                'x-proxied-by': 'upsun-smooth-bridge'
            });
            proxyRes.pipe(res);
            
            console.log(`✅ ${req.method} ${url} → ${proxyRes.statusCode} (retry=${retryCount})`);
            resolve();
        });
        
        proxyReq.on('error', async (err) => {
            console.error(`❌ Erreur (${retryCount+1}/${maxRetries+1}): ${err.message}`);
            
            // Si c'est une erreur de rate limit ou timeout, on retarde
            if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message.includes('429')) {
                if (retryCount < maxRetries) {
                    const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 10000);
                    console.log(`🔄 Retry dans ${backoffTime}ms...`);
                    
                    await delay(backoffTime);
                    
                    // Augmenter le backoff pour les prochains essais
                    RATE_LIMIT.backoffDelay = Math.min(RATE_LIMIT.backoffDelay * 2, RATE_LIMIT.maxBackoff);
                    
                    // Réessayer
                    await handleProxyRequest(req, res, url, retryCount + 1);
                    resolve();
                    return;
                }
            }
            
            // Échec définitif
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(`Bad Gateway: ${err.message}\n`);
            }
            resolve();
        });
        
        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            console.error(`⏰ Timeout sur ${url}`);
        });
        
        // Pipe le body de la requête si présent
        if (req.body) {
            proxyReq.write(req.body);
        }
        req.pipe(proxyReq);
    });
}

// Serveur principal avec mise en file d'attente
const server = http.createServer((req, res) => {
    const url = req.url;
    
    // Routes rapides (pas de rate limiting)
    if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`Serveur XHTTP SMOOTH OK\n\nÉtat:\n- Rate limit: ${RATE_LIMIT.currentRequests}/${RATE_LIMIT.maxRequestsPerMinute}\n- Queue: ${requestQueue.length}\n- Actives: ${activeRequests}/${CONNECTION_POOL.maxSockets}\n\nLiens:\n- /config\n- /${UUID}\n- /${VPS_IP}\n`);
        console.log(`📄 État affiché (${RATE_LIMIT.currentRequests}/${RATE_LIMIT.maxRequestsPerMinute})`);
        return;
    }
    
    // Génération des liens (pas de rate limiting)
    if (url === `/${UUID}` || url === '/config' || url === `/${VPS_IP}`) {
        const vlessLink = `vless://${UUID}@${VPS_HOST}:${VPS_PORT}?type=xhttp&encryption=none&path=${XHTTP_PATH}&host=${HOST_HEADER}&mode=${XHTTP_MODE}&x_padding_bytes=${XHTTP_PADDING}&extra=%7B%22xPaddingBytes%22%3A%22${XHTTP_PADDING}%22%7D&security=tls&fp=${FP}&alpn=${ALPN.join('%2C')}&sni=${SNI}#XHTTP-Upsun-Smooth`;
        
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(vlessLink + '\n');
        console.log(`🔗 Lien VLESS généré (${url})`);
        return;
    }
    
    // Mise en file d'attente pour les requêtes proxy
    requestQueue.push({ req, res, url });
    
    // Limiter la taille de la file d'attente
    if (requestQueue.length > 50) {
        const dropped = requestQueue.shift();
        dropped.res.writeHead(503, { 'Content-Type': 'text/plain' });
        dropped.res.end('Service Busy: Queue full, please retry\n');
        console.log(`⚠️ File pleine, requête abandonnée`);
    }
    
    console.log(`📥 File: ${requestQueue.length} | Actives: ${activeRequests}`);
    processQueue();
});

// Nettoyage périodique de la file d'attente
setInterval(() => {
    const now = Date.now();
    if (now - RATE_LIMIT.lastReset >= 60000) {
        RATE_LIMIT.currentRequests = 0;
        RATE_LIMIT.lastReset = now;
        console.log(`🔄 Reset compteur rate limit`);
        processQueue(); // Relancer le traitement
    }
}, 10000);

// Health check endpoint pour Upsun
server.on('request', (req, res) => {
    if (req.url === '/health' || req.url === '/_health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            queue: requestQueue.length,
            active: activeRequests,
            rateLimit: `${RATE_LIMIT.currentRequests}/${RATE_LIMIT.maxRequestsPerMinute}`
        }));
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Bridge SMOOTH actif sur le port ${PORT}`);
    console.log('');
    console.log(`🔗 LIENS VLESS :`);
    console.log(`   https://${DOMAIN}/config`);
    console.log(`   https://${DOMAIN}/${UUID}`);
    console.log(`   https://${DOMAIN}/${VPS_IP}`);
    console.log('');
    console.log(`💡 Statut: http://${DOMAIN}/`);
});

server.on('error', (err) => {
    console.error(`❌ Erreur serveur: ${err.message}`);
});

process.on('SIGTERM', () => {
    console.log('🛑 Arrêt smooth...');
    server.close(() => {
        httpAgent.destroy();
        process.exit(0);
    });
});
