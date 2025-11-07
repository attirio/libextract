import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

export type ProjectEnvironment = 'nodejs' | 'deno' | 'bun' | 'unknown';
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'none';

/**
 * Contexto completo del proyecto origen
 */
export interface ProjectContext {
  environment: ProjectEnvironment;
  packageManager: PackageManager;
  manifestPath: string | null;
  lockfilePath: string | null;
  dependencies: Map<string, string>;
  devDependencies: Map<string, string>;
  tsConfigPath: string | null;
  compilerOptions: ts.CompilerOptions;
  pathAliases: Map<string, string>;
}

/**
 * Detecta el ambiente y configuración del proyecto
 */
export class ProjectDetector {
  constructor(private projectRoot: string) {}

  public detect(): ProjectContext {
    const environment = this.detectEnvironment();
    const packageManager = this.detectPackageManager(environment);
    const manifestPath = this.findManifestPath(environment);
    const lockfilePath = this.findLockfilePath(packageManager);

    const { dependencies, devDependencies } = this.parseDependencies(
      environment,
      manifestPath
    );

    const tsConfigPath = this.findTsConfigPath();
    const { compilerOptions, pathAliases } = this.parseTsConfig(tsConfigPath);

    return {
      environment,
      packageManager,
      manifestPath,
      lockfilePath,
      dependencies,
      devDependencies,
      tsConfigPath,
      compilerOptions,
      pathAliases,
    };
  }

  /**
   * Detecta el ambiente del proyecto
   */
  private detectEnvironment(): ProjectEnvironment {
    // 1. Deno
    if (fs.existsSync(path.join(this.projectRoot, 'deno.json')) ||
        fs.existsSync(path.join(this.projectRoot, 'deno.jsonc'))) {
      return 'deno';
    }

    // 2. Bun (si tiene bun.lockb sin package.json, es proyecto Bun puro)
    const hasBunLock = fs.existsSync(path.join(this.projectRoot, 'bun.lockb'));
    const hasPackageJson = fs.existsSync(path.join(this.projectRoot, 'package.json'));

    if (hasBunLock && !hasPackageJson) {
      return 'bun';
    }

    // 3. Node.js (tiene package.json)
    if (hasPackageJson) {
      return 'nodejs';
    }

    // 4. Unknown (JavaScript/TypeScript sin manifiesto)
    return 'unknown';
  }

  /**
   * Detecta el package manager utilizado
   */
  private detectPackageManager(environment: ProjectEnvironment): PackageManager {
    if (environment === 'deno') {
      return 'none';
    }

    // Orden de prioridad por especificidad del lockfile
    if (fs.existsSync(path.join(this.projectRoot, 'bun.lockb'))) {
      return 'bun';
    }

    if (fs.existsSync(path.join(this.projectRoot, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }

    if (fs.existsSync(path.join(this.projectRoot, 'yarn.lock'))) {
      return 'yarn';
    }

    if (fs.existsSync(path.join(this.projectRoot, 'package-lock.json'))) {
      return 'npm';
    }

    // Si hay package.json pero sin lockfile, asumir npm
    if (environment === 'nodejs' || environment === 'bun') {
      return 'npm';
    }

    return 'none';
  }

  /**
   * Encuentra la ruta del manifiesto principal
   */
  private findManifestPath(environment: ProjectEnvironment): string | null {
    switch (environment) {
      case 'deno': {
        const denoJson = path.join(this.projectRoot, 'deno.json');
        if (fs.existsSync(denoJson)) return denoJson;

        const denoJsonc = path.join(this.projectRoot, 'deno.jsonc');
        if (fs.existsSync(denoJsonc)) return denoJsonc;

        return null;
      }

      case 'nodejs':
      case 'bun': {
        const packageJson = path.join(this.projectRoot, 'package.json');
        if (fs.existsSync(packageJson)) return packageJson;
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Encuentra la ruta del lockfile
   */
  private findLockfilePath(packageManager: PackageManager): string | null {
    const lockfiles: Record<PackageManager, string | null> = {
      'npm': 'package-lock.json',
      'yarn': 'yarn.lock',
      'pnpm': 'pnpm-lock.yaml',
      'bun': 'bun.lockb',
      'none': null,
    };

    const lockfile = lockfiles[packageManager];
    if (!lockfile) return null;

    const lockfilePath = path.join(this.projectRoot, lockfile);
    return fs.existsSync(lockfilePath) ? lockfilePath : null;
  }

  /**
   * Parsea las dependencias del manifiesto
   */
  private parseDependencies(
    environment: ProjectEnvironment,
    manifestPath: string | null
  ): { dependencies: Map<string, string>; devDependencies: Map<string, string> } {
    const dependencies = new Map<string, string>();
    const devDependencies = new Map<string, string>();

    if (!manifestPath || !fs.existsSync(manifestPath)) {
      return { dependencies, devDependencies };
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      if (environment === 'nodejs' || environment === 'bun') {
        // package.json
        if (manifest.dependencies) {
          for (const [name, version] of Object.entries(manifest.dependencies)) {
            dependencies.set(name, version as string);
          }
        }

        if (manifest.devDependencies) {
          for (const [name, version] of Object.entries(manifest.devDependencies)) {
            devDependencies.set(name, version as string);
          }
        }
      } else if (environment === 'deno') {
        // deno.json - imports pueden tener npm: specifiers
        if (manifest.imports) {
          for (const [alias, specifier] of Object.entries(manifest.imports)) {
            if (typeof specifier === 'string' && specifier.startsWith('npm:')) {
              // npm:package@version -> extraer nombre y versión
              const match = specifier.match(/^npm:([^@]+)(?:@(.+))?$/);
              if (match) {
                const [, name, version] = match;
                dependencies.set(name, version || 'latest');
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  No se pudo parsear ${manifestPath}: ${error}`);
    }

    return { dependencies, devDependencies };
  }

  /**
   * Encuentra el tsconfig.json
   */
  private findTsConfigPath(): string | null {
    const tsconfigPath = ts.findConfigFile(
      this.projectRoot,
      ts.sys.fileExists,
      'tsconfig.json'
    );

    return tsconfigPath || null;
  }

  /**
   * Parsea tsconfig.json para obtener compilerOptions y path aliases
   */
  private parseTsConfig(tsconfigPath: string | null): {
    compilerOptions: ts.CompilerOptions;
    pathAliases: Map<string, string>;
  } {
    const pathAliases = new Map<string, string>();
    let compilerOptions: ts.CompilerOptions = {};

    if (!tsconfigPath || !fs.existsSync(tsconfigPath)) {
      return { compilerOptions, pathAliases };
    }

    try {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const configDir = path.dirname(tsconfigPath);

      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        configDir
      );

      compilerOptions = parsedConfig.options;

      // Extraer path aliases
      const paths = compilerOptions.paths;
      const baseUrl = compilerOptions.baseUrl;

      if (paths && baseUrl) {
        for (const [alias, mappings] of Object.entries(paths)) {
          // "@/*" -> "@"
          const cleanAlias = alias.replace(/\/\*$/, '');
          // "src/*" -> "src"
          const cleanMapping = mappings[0].replace(/\/\*$/, '');
          const absolutePath = path.resolve(configDir, baseUrl, cleanMapping);
          pathAliases.set(cleanAlias, absolutePath);
        }
      }
    } catch (error) {
      console.warn(`⚠️  No se pudo parsear ${tsconfigPath}: ${error}`);
    }

    return { compilerOptions, pathAliases };
  }
}
