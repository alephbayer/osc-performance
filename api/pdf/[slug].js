export default function handler(req, res) {
  const { slug } = req.query;
  if (!slug) return res.status(400).send("Not found");

  const fileName = decodeURIComponent(slug);
  // Strip timestamp prefix and underscores for display
  const displayName = fileName.replace(/^\d+_/, "").replace(/_/g, " ").replace(/\.pdf$/i, "");
  const pdfUrl = `https://lchfmoeyzgbepunetuch.supabase.co/storage/v1/object/public/portfolio/${encodeURIComponent(fileName)}`;
  const pageUrl = `https://osc-performance.vercel.app/api/pdf/${encodeURIComponent(fileName)}`;
  const logoUrl = `https://osc-performance.vercel.app/osc-icon-192.png`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>OSC Performance | ${displayName}</title>

  <!-- Open Graph -->
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${pageUrl}"/>
  <meta property="og:title" content="OSC Performance | Portfólio"/>
  <meta property="og:description" content="${displayName}"/>
  <meta property="og:image" content="${logoUrl}"/>
  <meta property="og:image:width" content="512"/>
  <meta property="og:image:height" content="512"/>

  <!-- Twitter / WhatsApp fallback -->
  <meta name="twitter:card" content="summary"/>
  <meta name="twitter:title" content="OSC Performance | Portfólio"/>
  <meta name="twitter:description" content="${displayName}"/>
  <meta name="twitter:image" content="${logoUrl}"/>

  <meta http-equiv="refresh" content="0; url=${pdfUrl}"/>
  <style>
    body { margin: 0; background: #0a0a0f; color: #f0f0f8; font-family: 'Inter', sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; flex-direction: column; gap: 16px; }
    .logo { font-size: 22px; font-weight: 900; letter-spacing: -.5px; }
    .logo span { color: #ff6b00; }
    .msg { font-size: 14px; color: #9999bb; }
    a { color: #ff6b00; }
  </style>
</head>
<body>
  <div class="logo">OSC <span>Performance</span></div>
  <div class="msg">Abrindo <strong>${displayName}</strong>…</div>
  <div class="msg"><a href="${pdfUrl}">Clique aqui se não abrir automaticamente</a></div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=3600");
  res.status(200).send(html);
}
