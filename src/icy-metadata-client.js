const http = require('http');
const https = require('https');
const { URL } = require('url');

function createIcyMetadataClient(options) {
  const userAgent = options.userAgent;
  const log = options.log;
  const isPlaying = options.isPlaying;
  const onTrackTitle = options.onTrackTitle;

  let currentRequest = null;
  let reconnectTimer = null;
  let clientToken = 0;
  let currentStreamUrl = '';
  let currentTrackTitle = '';

  function isCurrentClient(token, streamUrl) {
    return token === clientToken && streamUrl === currentStreamUrl;
  }

  function destroyRequest(reason) {
    if (!currentRequest) return;
    try {
      currentRequest.destroy();
    } catch (err) {
      log('[icy] Request destroy failed', `${reason}: ${err.message || String(err)}`);
    }
    currentRequest = null;
  }

  function stop() {
    clientToken++;
    currentStreamUrl = '';
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    destroyRequest('stop');
    currentTrackTitle = '';
  }

  function scheduleReconnect(streamUrl, token = clientToken) {
    if (!isCurrentClient(token, streamUrl)) return;
    destroyRequest('reconnect');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (isPlaying() && streamUrl && isCurrentClient(token, streamUrl)) {
      reconnectTimer = setTimeout(() => {
        if (isCurrentClient(token, streamUrl)) start(streamUrl);
      }, 5000);
    }
  }

  function start(streamUrl, redirectCount = 0, token = null) {
    if (token === null) {
      stop();
      token = ++clientToken;
    }
    if (!isPlaying() || !streamUrl) return;
    currentStreamUrl = streamUrl;

    if (redirectCount > 5) {
      log('[icy] Too many redirects for url: ' + streamUrl);
      return;
    }

    try {
      const parsedUrl = new URL(streamUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(
        streamUrl,
        {
          headers: {
            'Icy-MetaData': '1',
            'User-Agent': userAgent,
          },
        },
        (res) => {
          if (!isCurrentClient(token, streamUrl)) {
            res.destroy();
            return;
          }
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            req.destroy();
            start(res.headers.location, redirectCount + 1, token);
            return;
          }

          if (res.statusCode !== 200) {
            log(`[icy] HTTP Status: ${res.statusCode} for ${streamUrl}`);
            req.destroy();
            scheduleReconnect(streamUrl, token);
            return;
          }

          const metaint = parseInt(res.headers['icy-metaint'], 10);
          if (!metaint || isNaN(metaint)) {
            return;
          }

          let bytesRead = 0;
          let nextMeta = metaint;
          let metaBuffer = null;
          let metaLength = 0;
          let readingMeta = false;

          res.on('data', (chunk) => {
            if (!isCurrentClient(token, streamUrl)) return;
            let offset = 0;
            while (offset < chunk.length) {
              if (!readingMeta) {
                const bytesNeeded = nextMeta - bytesRead;
                const bytesAvailable = chunk.length - offset;
                const toRead = Math.min(bytesNeeded, bytesAvailable);

                bytesRead += toRead;
                offset += toRead;

                if (bytesRead === nextMeta) {
                  readingMeta = true;
                  bytesRead = 0;
                  if (offset < chunk.length) {
                    const lenByte = chunk[offset];
                    offset++;
                    metaLength = lenByte * 16;
                    if (metaLength > 0) {
                      metaBuffer = Buffer.alloc(metaLength);
                    } else {
                      readingMeta = false;
                      nextMeta = metaint;
                    }
                  } else {
                    metaLength = -1;
                  }
                }
              } else {
                if (metaLength === -1) {
                  const lenByte = chunk[offset];
                  offset++;
                  metaLength = lenByte * 16;
                  if (metaLength > 0) {
                    metaBuffer = Buffer.alloc(metaLength);
                  } else {
                    readingMeta = false;
                    nextMeta = metaint;
                  }
                  continue;
                }

                const bytesNeeded = metaLength - bytesRead;
                const bytesAvailable = chunk.length - offset;
                const toRead = Math.min(bytesNeeded, bytesAvailable);

                if (metaBuffer) {
                  chunk.copy(metaBuffer, bytesRead, offset, offset + toRead);
                }
                bytesRead += toRead;
                offset += toRead;

                if (bytesRead === metaLength) {
                  const rawMeta = metaBuffer ? metaBuffer.toString('utf8') : '';
                  const match = rawMeta.match(/StreamTitle='([^']*)'/);
                  if (match && match[1]) {
                    const title = match[1].trim();
                    if (title && title !== currentTrackTitle) {
                      currentTrackTitle = title;
                      onTrackTitle(title);
                    }
                  }
                  readingMeta = false;
                  bytesRead = 0;
                  nextMeta = metaint;
                }
              }
            }
          });

          res.on('end', () => {
            scheduleReconnect(streamUrl, token);
          });

          res.on('error', (err) => {
            if (!isCurrentClient(token, streamUrl)) return;
            log('[icy] Response error: ' + err.message);
            scheduleReconnect(streamUrl, token);
          });
        }
      );

      req.on('error', (err) => {
        if (!isCurrentClient(token, streamUrl)) return;
        log('[icy] Request error: ' + err.message);
        scheduleReconnect(streamUrl, token);
      });

      currentRequest = req;
    } catch (err) {
      log('[icy] Connection setup failed: ' + err.message);
      scheduleReconnect(streamUrl, token);
    }
  }

  function getCurrentTrackTitle() {
    return currentTrackTitle;
  }

  return { start, stop, getCurrentTrackTitle };
}

module.exports = { createIcyMetadataClient };
