const express = require("express");
const { execFile, spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY; // definido nas variáveis de ambiente do Render

// Checagem de saúde (o Render usa isso pra saber se o serviço está de pé)
app.get("/", (req, res) => {
  res.send("tiktok-render-server no ar");
});

app.get("/extract", (req, res) => {
  // Exige a chave secreta (evita que qualquer um na internet use seu servidor de graça)
  if (!API_KEY || req.get("x-api-key") !== API_KEY) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  const tiktokUrl = (req.query.url || "").trim();
  if (!/^https:\/\/(www\.)?(vt\.|vm\.)?tiktok\.com\//.test(tiktokUrl)) {
    return res.status(400).json({ error: "Envie um link válido do TikTok" });
  }

  // -g / --get-url: só pede o link direto do vídeo (sem baixar o arquivo aqui)
  // --no-playlist: garante que baixa só o vídeo desse link, não a conta inteira
  execFile(
    "yt-dlp",
    ["-g", "--no-warnings", "--no-playlist", tiktokUrl],
    { timeout: 20000, maxBuffer: 1024 * 1024 },
    (err, stdout, stderr) => {
      if (err) {
        return res.status(422).json({
          error: "yt-dlp não conseguiu extrair esse vídeo",
          detalhe: (stderr || err.message || "").toString().slice(0, 500),
        });
      }

      const linhas = stdout.toString().trim().split("\n").filter(Boolean);
      const videoUrl = linhas[0] || null;

      if (!videoUrl) {
        return res.status(422).json({ error: "yt-dlp não retornou nenhum link" });
      }

      return res.json({ success: true, url: videoUrl });
    }
  );
});

// Baixa o vídeo de verdade e devolve os bytes direto (o link direto do TikTok só
// funciona sendo buscado por este servidor — por isso o Cloudflare Worker chama
// essa rota em vez de tentar buscar o link do TikTok sozinho).
app.get("/download", (req, res) => {
  if (!API_KEY || req.get("x-api-key") !== API_KEY) {
    return res.status(401).end("Não autorizado");
  }

  const tiktokUrl = (req.query.url || "").trim();
  if (!/^https:\/\/(www\.)?(vt\.|vm\.)?tiktok\.com\//.test(tiktokUrl)) {
    return res.status(400).end("Link inválido");
  }

  const proc = spawn("yt-dlp", [
    "-o", "-",
    "--no-warnings",
    "--no-playlist",
    "--socket-timeout", "15", // desiste de uma conexão travada com o TikTok depois de 15s
    tiktokUrl,
  ]);

  let respondeuHeader = false;
  let terminado = false;

  // Se depois de 25s nada aconteceu (nem um byte, nem erro), mata o processo
  // e responde com erro em vez de deixar o navegador girando pra sempre.
  const timeoutGeral = setTimeout(() => {
    if (!terminado) {
      terminado = true;
      proc.kill("SIGKILL");
      if (!res.headersSent) {
        res.status(504).end("Demorou demais pra baixar esse vídeo, tenta de novo");
      } else {
        res.end();
      }
    }
  }, 25000);

  proc.stdout.once("data", (chunk) => {
    if (!respondeuHeader) {
      respondeuHeader = true;
      res.status(200);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", 'attachment; filename="tiktok-video.mp4"');
    }
    res.write(chunk);
  });
  proc.stdout.on("data", (chunk) => res.write(chunk));
  proc.stdout.on("end", () => {
    terminado = true;
    clearTimeout(timeoutGeral);
    res.end();
  });

  proc.stderr.on("data", () => {}); // só pra não travar o processo com o buffer cheio

  proc.on("error", () => {
    terminado = true;
    clearTimeout(timeoutGeral);
    if (!res.headersSent) res.status(502).end("Erro ao iniciar o download");
  });
  proc.on("close", (code) => {
    terminado = true;
    clearTimeout(timeoutGeral);
    if (code !== 0 && !respondeuHeader) {
      res.status(422).end("yt-dlp não conseguiu baixar esse vídeo");
    }
  });
});

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});

