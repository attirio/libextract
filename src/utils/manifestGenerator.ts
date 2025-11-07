import * as fs from 'fs';
import * as path from 'path';
import { ProjectContext } from './projectDetector';
import { ExternalDependency } from './importGenerator';

/**
 * Genera manifiestos de dependencias (package.json, deno.json, etc.)
 */
export class ManifestGenerator {
  constructor(private projectContext: ProjectContext) {}

  /**
   * Genera el manifiesto apropiado según el ambiente
   */
  public generateManifest(
    externalDeps: Map<string, ExternalDependency>,
    outputDir: string
  ): void {
    if (externalDeps.size === 0) {
      console.log('📦 No hay dependencias externas, no se generará manifiesto');
      return;
    }

    switch (this.projectContext.environment) {
      case 'nodejs':
      case 'bun':
        this.generatePackageJson(externalDeps, outputDir);
        break;

      case 'deno':
        this.generateDenoJson(externalDeps, outputDir);
        break;

      case 'unknown':
        // Si hay dependencias externas, generar package.json por defecto
        console.log('⚠️  Ambiente desconocido, generando package.json por defecto');
        this.generatePackageJson(externalDeps, outputDir);
        break;
    }
  }

  /**
   * Genera package.json
   */
  private generatePackageJson(
    externalDeps: Map<string, ExternalDependency>,
    outputDir: string
  ): void {
    const dependencies: Record<string, string> = {};
    const devDependencies: Record<string, string> = {};

    for (const dep of externalDeps.values()) {
      // Ignorar URLs y specifiers especiales
      if (dep.packageName.startsWith('http://') ||
          dep.packageName.startsWith('https://') ||
          dep.packageName.startsWith('jsr:')) {
        console.log(`  ⚠️  Dependencia no compatible con npm: ${dep.packageName}`);
        continue;
      }

      const version = dep.version || 'latest';

      if (dep.isDevDependency) {
        devDependencies[dep.packageName] = version;
      } else {
        dependencies[dep.packageName] = version;
      }
    }

    // Detectar type: module vs commonjs
    let moduleType: 'module' | 'commonjs' = 'commonjs';
    if (this.projectContext.manifestPath) {
      try {
        const originalManifest = JSON.parse(
          fs.readFileSync(this.projectContext.manifestPath, 'utf-8')
        );
        if (originalManifest.type === 'module') {
          moduleType = 'module';
        }
      } catch (error) {
        // Ignorar error, usar default
      }
    }

    const packageJson: any = {
      name: 'extracted-code',
      version: '1.0.0',
      type: moduleType,
    };

    if (Object.keys(dependencies).length > 0) {
      packageJson.dependencies = dependencies;
    }

    if (Object.keys(devDependencies).length > 0) {
      packageJson.devDependencies = devDependencies;
    }

    const outputPath = path.join(outputDir, 'package.json');
    fs.writeFileSync(outputPath, JSON.stringify(packageJson, null, 2) + '\n');

    console.log(`\n📦 Generado package.json con ${externalDeps.size} dependencias:`);
    console.log(`   ├─ dependencies: ${Object.keys(dependencies).length}`);
    console.log(`   └─ devDependencies: ${Object.keys(devDependencies).length}`);
  }

  /**
   * Genera deno.json
   */
  private generateDenoJson(
    externalDeps: Map<string, ExternalDependency>,
    outputDir: string
  ): void {
    const imports: Record<string, string> = {};

    for (const dep of externalDeps.values()) {
      const spec = dep.packageName;

      if (spec.startsWith('npm:') || spec.startsWith('jsr:')) {
        // Ya es un specifier válido de Deno
        imports[spec] = spec;
      } else if (spec.startsWith('http://') || spec.startsWith('https://')) {
        // URL directa
        imports[spec] = spec;
      } else {
        // Convertir a npm: specifier
        const version = dep.version || 'latest';
        const npmSpec = `npm:${spec}@${version}`;
        imports[spec] = npmSpec;
      }
    }

    const denoJson: any = {
      imports,
    };

    // Copiar compilerOptions si existen
    if (Object.keys(this.projectContext.compilerOptions).length > 0) {
      denoJson.compilerOptions = this.projectContext.compilerOptions;
    }

    const outputPath = path.join(outputDir, 'deno.json');
    fs.writeFileSync(outputPath, JSON.stringify(denoJson, null, 2) + '\n');

    console.log(`\n🦕 Generado deno.json con ${Object.keys(imports).length} imports`);
  }

  /**
   * Genera un reporte de dependencias
   */
  public generateDependencyReport(
    externalDeps: Map<string, ExternalDependency>,
    outputDir: string
  ): void {
    if (externalDeps.size === 0) {
      return;
    }

    const report: string[] = [];
    report.push('# Reporte de Dependencias Externas\n');
    report.push(`Generado: ${new Date().toISOString()}\n`);
    report.push(`Ambiente: ${this.projectContext.environment}\n`);
    report.push(`Total de dependencias: ${externalDeps.size}\n`);

    for (const dep of externalDeps.values()) {
      report.push(`\n## ${dep.packageName}`);
      report.push(`- Versión: ${dep.version || 'latest'}`);
      report.push(`- Tipo: ${dep.isDevDependency ? 'devDependency' : 'dependency'}`);
      report.push(`- Símbolos importados (${dep.importedSymbols.size}):`);

      const symbols = Array.from(dep.importedSymbols).sort();
      for (const symbol of symbols) {
        report.push(`  - ${symbol}`);
      }

      report.push(`- Tipos de import: ${Array.from(dep.importKinds).join(', ')}`);
    }

    const reportPath = path.join(outputDir, 'DEPENDENCIES.md');
    fs.writeFileSync(reportPath, report.join('\n'));

    console.log(`\n📄 Generado reporte de dependencias: DEPENDENCIES.md`);
  }
}
