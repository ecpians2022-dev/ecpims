import fs from 'fs';
import path from 'path';

try {
  console.log('Running post-build processor for offline compatibility...');
  
  const distHtmlPath = path.join('dist', 'index.html');
  if (!fs.existsSync(distHtmlPath)) {
    throw new Error('dist/index.html does not exist. Did the build fail?');
  }

  let html = fs.readFileSync(distHtmlPath, 'utf8');

  // Keep type="module" but remove crossorigin attribute for inline scripts.
  // This ensures the bundle executes in its native ES module scope (avoiding global namespace pollution)
  // while preventing CORS blocks under the local file:// protocol.
  console.log('Replacing <script type="module" crossorigin> with <script type="module">...');
  html = html.replace(/<script type="module" crossorigin>/gi, '<script type="module">');

  // Remove any modulepreload links
  console.log('Removing link rel="modulepreload" tags...');
  html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/gi, '');

  // Escape potentially hazardous HTML tags inside inline Javascript to prevent HTML parser confusion
  console.log('Sanitizing inline script content to prevent HTML parser confusion...');
  html = html.replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/gi, (match, openTag, scriptContent, closeTag) => {
    let sanitized = scriptContent;
    // Replace html/head/body/title tags with Javascript escape sequences
    sanitized = sanitized.replace(/<html>/g, '\\x3Chtml>');
    sanitized = sanitized.replace(/<\/html>/g, '\\x3C/html>');
    sanitized = sanitized.replace(/<head>/g, '\\x3Chead>');
    sanitized = sanitized.replace(/<\/head>/g, '\\x3C/head>');
    sanitized = sanitized.replace(/<body>/g, '\\x3Cbody>');
    sanitized = sanitized.replace(/<\/body>/g, '\\x3C/body>');
    sanitized = sanitized.replace(/<title>/g, '\\x3Ctitle>');
    sanitized = sanitized.replace(/<\/title>/g, '\\x3C/title>');
    sanitized = sanitized.replace(/<meta/g, '\\x3Cmeta');
    sanitized = sanitized.replace(/<\/table>/g, '\\x3C/table>');
    return openTag + sanitized + closeTag;
  });

  // Ensure any dummy preseed tags are stripped from the built HTML
  html = html.replace(/<script[^>]*id="preseed-inventory-data"[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script>window\.preseededTimestamp[\s\S]*?<\/script>/gi, '');

  // Write out the processed html to the output targets
  console.log('Writing output files...');
  fs.writeFileSync(path.join('dist', 'index.html'), html);
  fs.writeFileSync(path.join('dist', 'index_single.html'), html);
  fs.writeFileSync(path.join('public', 'index_single.html'), html);
  fs.writeFileSync('index_single.html', html);

  // Copy ECP logos to root and dist folders so offline/standalone and zip versions have them right next to index.html
  console.log('Synchronizing ECP logos to root and dist folders...');
  const publicLogo = path.join('public', 'ecp_logo.jpg');
  const publicLogoSmall = path.join('public', 'ecp_logo_small.jpg');
  
  if (fs.existsSync(publicLogo)) {
    const logoData = fs.readFileSync(publicLogo);
    fs.writeFileSync('ecp_logo.jpg', logoData);
    fs.writeFileSync('ecp logo.jpg', logoData); // Support with space
    fs.writeFileSync(path.join('dist', 'ecp_logo.jpg'), logoData);
    fs.writeFileSync(path.join('dist', 'ecp logo.jpg'), logoData);
  }
  
  if (fs.existsSync(publicLogoSmall)) {
    const logoSmallData = fs.readFileSync(publicLogoSmall);
    fs.writeFileSync('ecp_logo_small.jpg', logoSmallData);
    fs.writeFileSync(path.join('dist', 'ecp_logo_small.jpg'), logoSmallData);
  }

  console.log('Post-build processing completed successfully!');
} catch (e) {
  console.error('Post-build process failed:', e.message);
  process.exit(1);
}
