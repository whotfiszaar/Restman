const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const desktopDir = __dirname;
const buildDir = path.join(rootDir, 'dist-desktop');
const releaseDir = path.join(rootDir, 'release-builds');

console.log('--- STARTING APIFY STANDALONE SINGLE-EXE BUILD ---');

// 1. Build the Vite project
console.log('Step 1: Building Vite production single-file bundle...');
try {
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
} catch (e) {
  console.error('Error during npm run build:', e);
  process.exit(1);
}

// 2. Setup dist-desktop folder
console.log('Step 2: Preparing compilation sandbox...');
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir);
fs.mkdirSync(path.join(buildDir, 'dist'));

// 3. Copy built files and electron wrapper
console.log('Step 3: Cloning distribution assets into packaging workspace...');
fs.copyFileSync(
  path.join(rootDir, 'dist', 'index.html'),
  path.join(buildDir, 'dist', 'index.html')
);
fs.copyFileSync(
  path.join(desktopDir, 'main.js'),
  path.join(buildDir, 'main.js')
);
fs.copyFileSync(
  path.join(desktopDir, 'preload.js'),
  path.join(buildDir, 'preload.js')
);
fs.copyFileSync(
  path.join(desktopDir, 'icon.ico'),
  path.join(buildDir, 'icon.ico')
);
fs.copyFileSync(
  path.join(desktopDir, '..', 'public', 'icon.png'),
  path.join(buildDir, 'icon.png')
);

// 4. Generate local package.json for Electron
console.log('Step 4: Writing temporary packaging manifest...');
const packageJsonContent = {
  name: "apify-desktop",
  version: "1.0.0",
  main: "main.js",
  description: "Apify - Premium API Studio Standalone Desktop Client",
  private: true,
  author: "Akib",
  dependencies: {}
};
fs.writeFileSync(
  path.join(buildDir, 'package.json'),
  JSON.stringify(packageJsonContent, null, 2)
);

// 5. Run electron-packager
console.log('Step 5: Invoking Electron compiler...');
const electronPackagedDir = path.join(releaseDir, 'Apify-win32-x64');
if (fs.existsSync(electronPackagedDir)) {
  fs.rmSync(electronPackagedDir, { recursive: true, force: true });
}

try {
  const cmd = `npx --package=electron-packager electron-packager "${buildDir}" Apify --platform=win32 --arch=x64 --electron-version=31.3.0 --out="${releaseDir}" --overwrite --icon="${path.join(desktopDir, 'icon.ico')}"`;
  execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
} catch (e) {
  console.error('Error during Electron packaging:', e);
  process.exit(1);
}

// 6. Compress Electron folder into app.zip using native bsdtar
console.log('Step 6: Compressing Electron bundle into app.zip...');
const zipPath = path.join(releaseDir, 'app.zip');
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

try {
  // Use native tar to compress into ZIP
  const cmd = `tar -acf "${zipPath}" -C "${electronPackagedDir}" .`;
  execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
} catch (e) {
  console.error('Error during compression:', e);
  process.exit(1);
}

// 7. Compile Launcher embedding app.zip
console.log('Step 7: Compiling C# launcher and embedding app.zip resource...');
const finalExePath = path.join(releaseDir, 'Apify.exe');
if (fs.existsSync(finalExePath)) {
  fs.unlinkSync(finalExePath);
}

try {
  // Portably resolve .NET csc compiler path using SystemRoot/windir env variables dynamically
  const windir = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const cscPath64 = path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const cscPath32 = path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  
  let cscPath = 'csc'; // fallback
  if (fs.existsSync(cscPath64)) {
    cscPath = cscPath64;
  } else if (fs.existsSync(cscPath32)) {
    cscPath = cscPath32;
  }

  const launcherSrc = path.join(desktopDir, 'Launcher.cs');
  
  // Compile using MS .NET compiler with reference to System.IO.Compression, Windows Forms, and Drawing libraries
  const cmd = `"${cscPath}" /target:winexe /out:"${finalExePath}" /r:System.IO.Compression.FileSystem.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /resource:"${zipPath}" /win32icon:"${path.join(desktopDir, 'icon.ico')}" "${launcherSrc}"`;
  console.log(`Executing compilation command: ${cmd}`);
  execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
  console.log('\n--- SUCCESS: Standalone Single-File Executable Compiled ---');
  console.log(`Executable file: ${finalExePath}`);
} catch (e) {
  console.error('Error compiling C# launcher:', e);
  process.exit(1);
}

// 8. Clean up intermediate directories and archives
console.log('Step 8: Cleaning up sandbox directories...');
try {
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  if (fs.existsSync(electronPackagedDir)) {
    fs.rmSync(electronPackagedDir, { recursive: true, force: true });
  }
  console.log('Clean up finished.');
} catch (e) {
  console.warn('Sandbox cleanup warning:', e.message);
}
