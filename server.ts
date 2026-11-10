import dotenv from "dotenv";
dotenv.config();
import express from "express";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";
import { execSync } from "child_process";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  // Restore development index.html if we are running in dev mode
  if (process.env.NODE_ENV !== "production") {
    try {
      const devPath = path.join(process.cwd(), "index_dev.html");
      const rootPath = path.join(process.cwd(), "index.html");
      if (fs.existsSync(devPath)) {
        fs.copyFileSync(devPath, rootPath);
        console.log("[Dev Server] Successfully restored development index.html for live preview.");
      }
    } catch (err: any) {
      console.warn("[Dev Server] Could not restore development index.html:", err.message);
    }
  }

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Helper to get index_single.html path
  const getSingleHtmlPath = () => {
    const paths = [
      path.join(process.cwd(), "dist", "index.html"),
      path.join(process.cwd(), "dist", "index_single.html"),
      path.join(process.cwd(), "index_single.html"),
      path.join(process.cwd(), "public", "index_single.html"),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  };

  // Helper to retrieve full compiled HTML (~2.2MB+) with optional preseed script injection
  const getCompiledHtmlWithPreseed = (customHtml?: string | null): Buffer | null => {
    const singleHtmlPath = getSingleHtmlPath();
    let baseHtml = singleHtmlPath && fs.existsSync(singleHtmlPath) ? fs.readFileSync(singleHtmlPath, "utf-8") : "";

    if (customHtml && customHtml.trim().length > 0) {
      if (customHtml.length > 500000) {
        // Full compiled bundle sent by client
        return Buffer.from(customHtml, "utf-8");
      }
      // If client sent small fallback HTML (<500KB), extract any preseed script tags from it
      if (baseHtml) {
        const preseedMatches = customHtml.match(/<script[\s\S]*?id="(?:preseed|preseed-inventory-data|preseed-system-users|preseed-database-state)"[\s\S]*?<\/script>/gi);
        if (preseedMatches && preseedMatches.length > 0) {
          const preseedBlock = preseedMatches.join("\n");
          if (baseHtml.includes("<head>")) {
            baseHtml = baseHtml.replace("<head>", `<head>\n${preseedBlock}\n`);
          } else if (baseHtml.includes("<HEAD>")) {
            baseHtml = baseHtml.replace("<HEAD>", `<HEAD>\n${preseedBlock}\n`);
          }
        }
      }
    }

    return baseHtml ? Buffer.from(baseHtml, "utf-8") : null;
  };

  // API endpoint to compile and get the latest single-file HTML
  app.get("/api/compile-single-html", (req, res) => {
    try {
      if (process.env.NODE_ENV !== "production") {
        try {
          console.log("Compiling latest preview code on-the-fly...");
          // Trigger a clean production build to ensure we capture all of the user's latest code changes!
          execSync("npm run build", { stdio: "inherit" });
          console.log("Compilation complete.");
        } catch (buildErr: any) {
          console.warn("On-the-fly compilation failed, serving pre-built file:", buildErr.message);
        }
      }

      const compiledBuffer = getCompiledHtmlWithPreseed();
      if (compiledBuffer) {
        res.setHeader("Content-Type", "text/html");
        res.send(compiledBuffer);
      } else {
        res.status(404).json({ error: "Compiled index_single.html not found." });
      }
    } catch (error: any) {
      console.error("Failed to compile latest single-file HTML:", error);
      res.status(500).json({ error: "Failed to compile latest preview HTML: " + error.message });
    }
  });

  // API endpoint to compile and download the latest single-file index.html directly as an attachment
  const handleSingleHtmlDownload = (req: express.Request, res: express.Response) => {
    try {
      if (process.env.NODE_ENV !== "production") {
        try {
          console.log("Compiling latest preview code on-the-fly for direct download...");
          execSync("npm run build", { stdio: "inherit" });
          console.log("Compilation complete.");
        } catch (buildErr: any) {
          console.warn("On-the-fly compilation failed, serving pre-built file:", buildErr.message);
        }
      }

      const customHtml = req.body && typeof req.body.html === "string" && req.body.html.trim().length > 0 ? req.body.html : null;
      const compiledBuffer = getCompiledHtmlWithPreseed(customHtml);

      if (compiledBuffer) {
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Content-Disposition", "attachment; filename=index.html");
        return res.send(compiledBuffer);
      } else {
        res.status(404).json({ error: "Compiled index_single.html not found." });
      }
    } catch (error: any) {
      console.error("Failed to compile latest single-file HTML:", error);
      res.status(500).json({ error: "Failed to compile latest preview HTML: " + error.message });
    }
  };

  app.get("/api/download-single-html", handleSingleHtmlDownload);
  app.post("/api/download-single-html", handleSingleHtmlDownload);

  // API endpoint to download the latest project source code as a ZIP
  const handleZipDownload = (req: express.Request, res: express.Response) => {
    try {
      if (process.env.NODE_ENV !== "production") {
        try {
          console.log("Preparing project ZIP: Triggering clean build to sync all files...");
          execSync("npm run build", { stdio: "inherit" });
          console.log("Clean build completed successfully.");
        } catch (buildError: any) {
          console.warn("Warning: Build step failed inside ZIP generator, proceeding with existing files:", buildError.message);
        }
      }

      const zip = new AdmZip();
      const workspaceRoot = process.cwd();
      const customHtml = req.body && typeof req.body.html === "string" && req.body.html.trim().length > 0 ? req.body.html : null;
      const compiledHtmlContent = getCompiledHtmlWithPreseed(customHtml);

      // Recursively add files to zip, excluding node_modules, dist, .git, etc.
      function addDirToZip(localPath: string, zipPath: string) {
        if (!fs.existsSync(localPath)) return;
        const items = fs.readdirSync(localPath);
        for (const item of items) {
          const fullPath = path.join(localPath, item);
          const stat = fs.statSync(fullPath);

          // Excluded directories/files to keep the ZIP lean and clean
          if (
            item === "node_modules" ||
            item === ".git" ||
            item === ".github" ||
            item === ".cache" ||
            item === "tmp" ||
            item === "index_dev.html" ||
            item === "index_source.html"
          ) {
            continue;
          }

          const relativeZipPath = zipPath ? `${zipPath}/${item}` : item;

          if (stat.isDirectory()) {
            addDirToZip(fullPath, relativeZipPath);
          } else {
            if (item === "index.html" && relativeZipPath === "index.html" && compiledHtmlContent) {
              zip.addFile("index_source.html", fs.readFileSync(fullPath));
              zip.addFile("index.html", compiledHtmlContent);
            } else {
              const content = fs.readFileSync(fullPath);
              zip.addFile(relativeZipPath, content);
            }
          }
        }
      }

      addDirToZip(workspaceRoot, "");

      // Ensure root index.html, index_single.html and dist/index.html contain the complete compiled standalone HTML in the ZIP
      if (compiledHtmlContent) {
        // Replace index.html in ZIP root with the complete standalone production bundle (~300KB+)
        const rootEntry = zip.getEntry("index.html");
        if (rootEntry) {
          zip.deleteFile(rootEntry);
        }
        zip.addFile("index.html", compiledHtmlContent);

        // Delete existing index_single.html entry if added during recursion
        const singleEntry = zip.getEntry("index_single.html");
        if (singleEntry) {
          zip.deleteFile(singleEntry);
        }
        zip.addFile("index_single.html", compiledHtmlContent);

        const distEntry = zip.getEntry("dist/index.html");
        if (distEntry) {
          zip.deleteFile(distEntry);
        }
        zip.addFile("dist/index.html", compiledHtmlContent);
      }

      // Ensure logos are at the root of the ZIP so they match relative image paths
      const logoPaths = [
        { name: "ecp_logo.jpg", src: path.join(workspaceRoot, "public", "ecp_logo.jpg") },
        { name: "ecp logo.jpg", src: path.join(workspaceRoot, "public", "ecp_logo.jpg") },
        { name: "ecp_logo_small.jpg", src: path.join(workspaceRoot, "public", "ecp_logo_small.jpg") }
      ];
      for (const logo of logoPaths) {
        if (fs.existsSync(logo.src)) {
          try {
            // Delete if already added to avoid duplication in ZIP structure
            const entry = zip.getEntry(logo.name);
            if (entry) {
              zip.deleteFile(entry);
            }
          } catch (e) {}
          zip.addFile(logo.name, fs.readFileSync(logo.src));
        }
      }

      const zipBuffer = zip.toBuffer();

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=ECP_Asset_Inventory_Project.zip"
      );
      res.setHeader("Content-Length", zipBuffer.length);
      res.send(zipBuffer);
    } catch (error: any) {
      console.error("Failed to generate ZIP archive:", error);
      res.status(500).json({ error: "Failed to generate ZIP archive: " + error.message });
    }
  };

  app.get("/api/download-project-zip", handleZipDownload);
  app.post("/api/download-project-zip", handleZipDownload);

  // --------------------------------------------------------------------------
  // AI ASSISTANT CHAT ENDPOINT (Server-Side Gemini API Integration)
  // --------------------------------------------------------------------------
  let geminiClient: GoogleGenAI | null = null;
  function getGeminiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
      return null;
    }
    if (!geminiClient) {
      geminiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
    return geminiClient;
  }

  // Rate limiting tracker (max 30 requests per minute per IP address)
  const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 30;

    const record = rateLimitMap.get(ip);
    if (!record || now > record.resetTime) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
      return true;
    }
    if (record.count >= maxRequests) {
      return false;
    }
    record.count += 1;
    return true;
  }

  app.post("/api/chat", async (req, res) => {
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(clientIp)) {
        return res.status(429).json({
          error: "Rate limit reached. Please wait a moment before sending another message.",
        });
      }

      const { messages, inventorySummary } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Invalid request: messages array is required." });
      }

      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || !lastMsg.content || typeof lastMsg.content !== "string" || !lastMsg.content.trim()) {
        return res.status(400).json({ error: "Message content cannot be empty." });
      }

      if (lastMsg.content.length > 2000) {
        return res.status(400).json({ error: "Message exceeds 2,000 characters limit." });
      }

      const client = getGeminiClient();
      if (!client) {
        return res.status(503).json({
          error: "Gemini API key is not configured. Please configure GEMINI_API_KEY in your environment or Secrets settings.",
        });
      }

      // Format history contents for @google/genai
      const contents = messages
        .filter((m: any) => m && m.content && (m.role === "user" || m.role === "assistant"))
        .slice(-10)
        .map((m: any) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: String(m.content).trim() }],
        }));

      if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
        contents.push({ role: "user", parts: [{ text: String(lastMsg.content).trim() }] });
      }

      const liveContextSnippet = inventorySummary && typeof inventorySummary === "object"
        ? `\nLIVE SYSTEM INVENTORY METRICS & SNAPSHOT:
- Total Assets Recorded: ${inventorySummary.totalAssets ?? "N/A"}
- Active Station Scope: ${inventorySummary.activeStation ?? "All Offices"}
- IT Equipment Count: ${inventorySummary.itCount ?? "N/A"}
- Furniture Assets Count: ${inventorySummary.furnitureCount ?? "N/A"}
- Miscellaneous Count: ${inventorySummary.miscCount ?? "N/A"}
- Working Assets: ${inventorySummary.workingCount ?? "N/A"} (Issued: ${inventorySummary.issuedCount ?? "N/A"}, In-Stock: ${inventorySummary.instockCount ?? "N/A"})
- Non-Working Assets: ${inventorySummary.nonWorkingCount ?? "N/A"} (Needs Repair: ${inventorySummary.needsRepairCount ?? "N/A"}, Condemnation: ${inventorySummary.condemnationCount ?? "N/A"})`
        : "";

      const systemInstruction = `You are the official AI Assistant for the Election Commission of Pakistan (ECP) Inventory Management System.
Your job is to provide helpful, polite, professional, and clear guidance to users of the portal.
${liveContextSnippet}

PORTAL OVERVIEW & SYSTEM CAPABILITIES:
1. Asset Ledger & Categories:
   - IT Equipment: Computers, laptops, servers, printers, scanners, networking switches, biometric kits.
   - Furniture Assets: Executive desks, conference tables, chairs, steel cabinets, with quantity allocation tracking.
   - Miscellaneous: Utility gear, office machinery, surveillance, tools.
2. User Accounts & Stations:
   - SuperAdmin: Global system privileges, consolidated all-office views, supervisor filter controls, and project export.
   - Divisional Accounts: REC (Regional Election Commissioner) and DEC (District Election Commissioner) stations for Kohat, Karak, Hangu, Kurram, and Orakzai.
3. Key Features:
   - Ledger View: Detailed table with station, category, asset name, serial/reg no, model, receiving date, condition status, and remarks.
   - Reports View: Comprehensive reporting with scope filters, live category breakdown counters, and condition alerts.
   - Print & PDF: Official A4 landscape print preview with single-line non-wrapping columns and direct "Save as PDF" button.
   - Excel Export: Direct download of formatted XLSX records.
   - Live Database Synchronization: Real-time Supabase cloud synchronization with instant offline fallback.

PROFESSIONAL ASSISTANT FEATURES:
- Can calculate, summarize, or explain inventory metrics when asked (using the live snapshot above).
- Can draft official ECP memo descriptions or remarks for asset issuance/condemnation when asked.
- Provide step-by-step guidance on creating new entries, generating reports, downloading offline bundles, and changing passwords.

STRICT OPERATIONAL BOUNDARIES:
- You provide informational, analytical, and procedural navigation guidance.
- You CANNOT directly execute database writes/deletes (e.g. SQL DELETE, INSERT).
- If a user asks you to modify or delete data, politely explain that data changes must be done directly through the portal forms by authorized officers.
- Be concise, accurate, and professional. Use formatting (bullet points, bold text) for clarity.`;

      const response = await client.models.generateContent({
        model: "gemini-3.8-flash",
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      const reply = response.text || "I'm sorry, I couldn't generate a response. Please try again.";
      return res.json({ reply });
    } catch (error: any) {
      console.error("Gemini API server error:", error);
      const errorMessage = error?.message || "Failed to generate AI response. Please try again later.";
      return res.status(500).json({ error: errorMessage });
    }
  });

  // Serve static assets or use Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development middleware mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Production static server configured.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
