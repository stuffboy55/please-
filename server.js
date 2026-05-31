const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Serveur XHTTP actif\n');
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
    console.log(`Serveur en écoute sur le port ${port}`);
});
