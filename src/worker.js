export default {
  async fetch(request, env, ctx) {
    const config = {
      anura: {
        instanceId: env.ANURA_INSTANCE_ID,
        apiKey: env.ANURA_API_KEY,
      },
      defaults: {
        redirectUrl: env.DEFAULT_REDIRECT_URL,
        deniedUrl: env.DEFAULT_DENIED_URL,
      },
    };

    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'healthy' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    if (url.pathname === '/go') {
      const redirectBase = url.searchParams.get('redirectUrl');
      const deniedBase = url.searchParams.get('deniedUrl');
      const security = url.searchParams.get('security');

      if (!isValidUrl(redirectBase) || !isValidUrl(deniedBase)) {
        return new Response('Invalid URLs provided', {
          status: 400,
          headers: corsHeaders,
        });
      }

      const redirectUrl = new URL(redirectBase);
      const deniedUrl = new URL(deniedBase);

      const redirectUrlParams = new URLSearchParams(
        redirectBase.split('?')[1] || ''
      );
      const deniedUrlParams = new URLSearchParams(
        deniedBase.split('?')[1] || ''
      );

      for (const [key, value] of redirectUrlParams) {
        redirectUrl.searchParams.set(key, value);
      }

      for (const [key, value] of deniedUrlParams) {
        deniedUrl.searchParams.set(key, value);
      }

      const pageParams = new URLSearchParams();
      pageParams.set('redirectUrl', redirectUrl.toString());
      pageParams.set('deniedUrl', deniedUrl.toString());
      if (security) {
        pageParams.set('security', security);
      }

      return new Response(getVerificationPage(config), {
        headers: {
          'Content-Type': 'text/html',
          ...corsHeaders,
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/verify') {
      try {
        const { responseId } = await request.json();
        const redirectUrl = url.searchParams.get('redirectUrl');
        const deniedUrl = url.searchParams.get('deniedUrl');
        const security = url.searchParams.get('security');

        if (!responseId) {
          return new Response(
            JSON.stringify({ error: 'Missing response ID' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
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
            finalUrl = deniedUrl || config.defaults.redirectUrl;
            break;
        }

        return new Response(JSON.stringify({ url: finalUrl }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ error: 'Internal server error' }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }
    }

    return new Response('Not found', {
      status: 404,
      headers: corsHeaders,
    });
  },
};

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function getVerificationPage(config) {
  return `<!DOCTYPE html>
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
  </html>`;
}
