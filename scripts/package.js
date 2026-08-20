import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function packageApp() {
  console.log('=== Empacotando Mini Voice para Windows ===');

  const rootDir = process.cwd();
  const releaseDir = path.join(rootDir, 'release');
  const outDir = path.join(releaseDir, 'Mini Voice');

  // Close running instances if any
  try {
    execSync('taskkill /F /IM "Mini Voice.exe" 2>nul', { stdio: 'ignore' });
    execSync('taskkill /F /IM "electron.exe" 2>nul', { stdio: 'ignore' });
  } catch (e) {}

  // Clean release directory
  if (fs.existsSync(outDir)) {
    console.log('Limpando pasta release/Mini Voice anterior...');
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Aviso: Alguns arquivos podem estar em uso. Tentando sobrescrever...');
    }
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Locate Electron prebuilt dist
  let electronDist = path.join(rootDir, 'apps/client/node_modules/electron/dist');
  if (!fs.existsSync(electronDist)) {
    electronDist = path.join(rootDir, 'node_modules/electron/dist');
  }
  if (!fs.existsSync(electronDist)) {
    throw new Error('Electron dist não encontrado em ' + electronDist);
  }

  console.log('1/4 Copiando binários do Electron...');
  fs.cpSync(electronDist, outDir, { recursive: true });

  // Rename electron.exe to "Mini Voice.exe"
  const oldExe = path.join(outDir, 'electron.exe');
  const newExe = path.join(outDir, 'Mini Voice.exe');
  if (fs.existsSync(oldExe)) {
    fs.renameSync(oldExe, newExe);
  }

  console.log('2/4 Estruturando pasta resources/app...');
  const appDir = path.join(outDir, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });

  // Copy apps/client dist and dist-electron
  fs.cpSync(path.join(rootDir, 'apps/client/dist'), path.join(appDir, 'dist'), { recursive: true });
  fs.cpSync(path.join(rootDir, 'apps/client/dist-electron'), path.join(appDir, 'dist-electron'), { recursive: true });
  if (fs.existsSync(path.join(rootDir, 'images'))) {
    fs.cpSync(path.join(rootDir, 'images'), path.join(appDir, 'images'), { recursive: true });
  }

  // Client package.json
  const clientPkg = {
    name: "mini-voice",
    version: "1.0.0",
    main: "dist-electron/main/main.js"
  };
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(clientPkg, null, 2), 'utf8');

  // Copy shared package to app node_modules/@mini-voice/shared
  const sharedTarget = path.join(appDir, 'node_modules', '@mini-voice', 'shared');
  fs.mkdirSync(sharedTarget, { recursive: true });
  fs.cpSync(path.join(rootDir, 'packages/shared/dist'), path.join(sharedTarget, 'dist'), { recursive: true });
  fs.cpSync(path.join(rootDir, 'packages/shared/package.json'), path.join(sharedTarget, 'package.json'));

  // Copy server package to app node_modules/@mini-voice/server
  const serverTarget = path.join(appDir, 'node_modules', '@mini-voice', 'server');
  fs.mkdirSync(serverTarget, { recursive: true });
  fs.cpSync(path.join(rootDir, 'apps/server/dist'), path.join(serverTarget, 'dist'), { recursive: true });
  fs.cpSync(path.join(rootDir, 'apps/server/package.json'), path.join(serverTarget, 'package.json'));

  // Copy migrations to server dist/infrastructure/database/migrations
  const migrationsTarget = path.join(serverTarget, 'dist', 'infrastructure', 'database', 'migrations');
  fs.mkdirSync(migrationsTarget, { recursive: true });
  fs.cpSync(path.join(rootDir, 'apps/server/src/infrastructure/database/migrations'), migrationsTarget, { recursive: true });

  console.log('3/4 Copiando dependências de produção para o app...');
  const modulesToCopy = ['ws', 'uuid', 'sql.js', 'zod'];
  const appModules = path.join(appDir, 'node_modules');
  fs.mkdirSync(appModules, { recursive: true });

  const searchRoots = [
    path.join(rootDir, 'node_modules'),
    path.join(rootDir, 'apps/server/node_modules'),
    path.join(rootDir, 'apps/client/node_modules'),
  ];

  for (const mod of modulesToCopy) {
    for (const searchRoot of searchRoots) {
      const srcMod = path.join(searchRoot, mod);
      if (fs.existsSync(srcMod)) {
        fs.cpSync(srcMod, path.join(appModules, mod), { recursive: true });
        break;
      }
    }
  }

  console.log('4/4 Gerando arquivo ZIP para envio fácil...');
  const zipPath = path.join(releaseDir, 'Mini-Voice-Windows.zip');
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  try {
    execSync(`powershell -Command "Compress-Archive -Path '${outDir}' -DestinationPath '${zipPath}' -Force"`, {
      stdio: 'inherit',
    });
    console.log(`✔ Arquivo ZIP gerado com sucesso em: ${zipPath}`);
  } catch (err) {
    console.warn('Compress-Archive falhou, mas a pasta release/Mini Voice está pronta.');
  }

  console.log('\n=============================================');
  console.log('🎉 EMPACOTAMENTO CONCLUÍDO COM SUCESSO!');
  console.log(`📂 Pasta Portátil: ${outDir}`);
  console.log(`   └─ Executável: ${newExe}`);
  console.log(`📦 Arquivo Compactado (ZIP): ${zipPath}`);
  console.log('=============================================\n');
}

packageApp().catch((err) => {
  console.error('Erro ao empacotar:', err);
  process.exit(1);
});
