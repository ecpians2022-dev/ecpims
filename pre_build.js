import fs from 'fs';
import path from 'path';

console.log('Restoring development index.html before build...');
try {
  const devPath = path.join(process.cwd(), 'index_dev.html');
  const rootPath = path.join(process.cwd(), 'index.html');
  if (fs.existsSync(devPath)) {
    fs.copyFileSync(devPath, rootPath);
    console.log('Successfully restored development index.html.');
  } else {
    console.warn('index_dev.html master copy not found, using existing index.html.');
  }
} catch (err) {
  console.error('Failed to restore development index.html:', err.message);
}

