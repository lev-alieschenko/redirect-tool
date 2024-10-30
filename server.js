const http = require('http');
const url = require('url');
require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  anura: {
    instanceId: process.env.ANURA_INSTANCE_ID,
    apiKey: process.env.ANURA_API_KEY,
  },
  defaults: {
    redirectUrl: process.env.DEFAULT_REDIRECT_URL,
    deniedUrl: process.env.DEFAULT_DENIED_URL,
  },
};

function validateConfig() {
  const required = ['ANURA_INSTANCE_ID', 'ANURA_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    console.error(
      'Missing required environment variables:',
      missing.join(', ')
    );
    process.exit(1);
  }
}

const getVerificationPage = () => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verification System</title>
    <style>
        body {
            margin: 0;
            font-family: system-ui, -apple-system, sans-serif;
            background-color: #f5f5f5;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            max-width: 400px;
            width: 90%;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3498db;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .error {
            color: #dc3545;
            display: none;
            margin-top: 1rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Processing your request...</h1>
        <div class="spinner"></div>
        <p>Please wait while we verify your session.</p>
        <p class="error" id="errorMessage">An error occurred. Please try again.</p>
    </div>

    <script>
        const urlParams = new URLSearchParams(window.location.search);
        
        window.handleAnuraResponse = async function() {
            if (window.Anura) {
                try {
                    const response = await fetch('/verify' + window.location.search, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            responseId: window.Anura.getAnura().getId()
                        })
                    });

                    if (!response.ok) {
                        throw new Error('Verification failed');
                    }

                    const data = await response.json();
                    window.location.href = data.url;
                } catch (error) {
                    console.error('Error:', error);
                    document.getElementById('errorMessage').style.display = 'block';
                    document.querySelector('.spinner').style.display = 'none';
                }
            }
        };

        (function() {
            const anura = document.createElement('script');
            if (typeof anura === 'object') {
                const request = {
                    instance: '${config.anura.instanceId}',
                    source: urlParams.get('source') || '',
                    campaign: urlParams.get('campaign') || '',
                    callback: 'handleAnuraResponse'
                };

                const params = [Math.floor(1E12 * Math.random() + 1)];
                for (const key in request) {
                    if (request[key]) {
                        params.push(\`\${key}=\${encodeURIComponent(request[key])}\`);
                    }
                }

                anura.type = 'text/javascript';
                anura.async = true;
                anura.src = 'https://script.anura.io/request.js?' + params.join('&');
                
                const firstScript = document.getElementsByTagName('script')[0];
                firstScript.parentNode.insertBefore(anura, firstScript);
            }
        })();
    </script>
</body>
</html>
`;

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  validateConfig();

  const parsedUrl = url.parse(req.url, true);
  console.log(`${req.method} ${parsedUrl.pathname}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (parsedUrl.pathname === '/go') {
    const { redirectUrl, deniedUrl, security } = parsedUrl.query;

    if (!isValidUrl(redirectUrl) || !isValidUrl(deniedUrl)) {
      res.writeHead(400);
      res.end('Invalid URLs provided');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getVerificationPage());
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/verify') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { responseId } = JSON.parse(body);
        const { redirectUrl, deniedUrl, security } = parsedUrl.query;

        if (!responseId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing response ID' }));
          return;
        }

        const anuraUrl = `https://script.anura.io/result.json?instance=${config.anura.instanceId}&id=${responseId}`;
        const anuraResponse = await fetch(anuraUrl, {
          headers: {
            Authorization: `Bearer ${config.anura.apiKey}`,
            Accept: 'application/json',
          },
        });

        if (!anuraResponse.ok) {
          throw new Error(`Anura API error: ${anuraResponse.status}`);
        }

        const data = await anuraResponse.json();
        let finalUrl = deniedUrl || config.defaults.deniedUrl;

        switch (security) {
          case 'strict':
            if (data.result === 'good') {
              finalUrl = redirectUrl || config.defaults.redirectUrl;
            }
            break;

          case 'medium':
            if (data.result !== 'bad') {
              finalUrl = redirectUrl || config.defaults.redirectUrl;
            }
            break;

          case 'none':
            finalUrl = redirectUrl || config.defaults.redirectUrl;
            break;

          default:
            finalUrl = deniedUrl || config.defaults.deniedUrl;
        }

        console.log({
          timestamp: new Date().toISOString(),
          security,
          anuraResult: data.result,
          finalDestination: finalUrl,
          source: parsedUrl.query.source,
          campaign: parsedUrl.query.campaign,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: finalUrl }));
      } catch (error) {
        console.error('Error:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Instance ID configured:', !!config.anura.instanceId);
  console.log('API Key configured:', !!config.anura.apiKey);
});
