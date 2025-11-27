# @tirio/libextract

[![npm version](https://img.shields.io/npm/v/@tirio/libextract.svg)](https://www.npmjs.com/package/@tirio/libextract)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

> 🔪 **Herramienta CLI inteligente para extraer símbolos y sus dependencias de proyectos TypeScript/JavaScript**

## 📖 Descripción

`@tirio/libextract` es una herramienta de línea de comandos que permite extraer funciones, clases, tipos y cualquier símbolo específico de un proyecto TypeScript/JavaScript junto con **todas sus dependencias transitivas**.

A diferencia de herramientas tradicionales de tree-shaking que trabajan a nivel de bundle, `libextract` opera a nivel de código fuente, generando un subconjunto mínimo y funcional de tu proyecto que contiene únicamente el código necesario para el símbolo extraído.

**¿Por qué usar libextract?**
- ✅ **Reduce el bundle size** identificando exactamente qué código necesitas
- ✅ **Facilita migraciones** extrayendo funcionalidades específicas entre proyectos
- ✅ **Analiza dependencias** mostrando el verdadero impacto de cada símbolo
- ✅ **Crea micro-bibliotecas** a partir de proyectos grandes
- ✅ **Code review inteligente** visualizando el alcance real de los cambios

---

## ✨ Características Principales

- 🎯 **Extracción granular por símbolo** - Funciones, clases, tipos, interfaces, variables
- 🔄 **Análisis automático de dependencias transitivas** - Encuentra todas las dependencias recursivamente
- 🗂️ **Soporte para TypeScript Path Aliases** - `@/`, `~/`, rutas personalizadas
- 📦 **Soporte para TypeScript Project References** - Proyectos multi-tsconfig
- 🌐 **Multi-ambiente** - Node.js, Deno, Bun
- 📝 **Generación automática de manifiestos** - `package.json` o `deno.json`
- 📊 **Reporte detallado de dependencias** - Markdown con todas las dependencias externas
- 🔗 **Manejo inteligente de re-exports** - Resuelve `index.ts` y `export * from`
- 🎨 **Distinción entre tipos y valores** - Import correcto según el contexto de uso
- 🏗️ **Preserva estructura de directorios** - Mantiene la organización original

---

## 📦 Instalación

```bash
# npm
npm install -g @tirio/libextract

# yarn
yarn global add @tirio/libextract

# pnpm
pnpm add -g @tirio/libextract

# bun
bun add -g @tirio/libextract
```

---

## 🚀 Inicio Rápido

### Uso Básico

```bash
# Extraer una función específica
libextract -p ./mi-proyecto -f ./src/utils.ts -s myFunction -o ./output

# Extraer todos los símbolos exportados de un archivo
libextract -p ./mi-proyecto -f ./src/api.ts -s "*" -o ./lib

# Extraer múltiples símbolos
libextract -p ./mi-proyecto -f ./src/helpers.ts -s "helper1,helper2,helper3" -o ./extracted
```

### Ejemplo Completo

Supongamos que tienes un proyecto con esta estructura:

```
mi-proyecto/
├── src/
│   ├── utils/
│   │   ├── math.ts       # export function add(a, b) { ... }
│   │   └── string.ts     # export function capitalize(s) { ... }
│   └── index.ts          # usa add() y capitalize()
└── package.json
```

Para extraer solo la función `add` y sus dependencias:

```bash
libextract -p ./mi-proyecto -f ./mi-proyecto/src/utils/math.ts -s add -o ./lib
```

**Resultado:**

```
lib/
├── src/
│   └── utils/
│       └── math.ts       # Solo la función add y sus dependencias
├── package.json          # Con las dependencias externas necesarias
└── DEPENDENCIES.md       # Reporte de dependencias
```

---

## 📚 Uso Detallado

### Opciones del CLI

```
Opciones:
  -p, --path <path>       Ruta del proyecto a analizar (requerido)
  -f, --file <file>       Archivo de entrada que contiene el símbolo (requerido)
  -s, --symbol <symbol>   Símbolo(s) a extraer. Usar "*" para todos (requerido)
  -o, --output <output>   Directorio de salida (requerido)
  -h, --help             Mostrar ayuda
```

### Ejemplos Prácticos

#### 1. Extraer una Función Específica

```bash
libextract \
  -p ./mi-proyecto \
  -f ./mi-proyecto/src/services/api.ts \
  -s fetchUserData \
  -o ./extracted
```

**Output:**
- Función `fetchUserData`
- Todas las funciones/clases/tipos que usa
- Archivos de dependencias internas
- `package.json` con dependencias externas (axios, etc.)

#### 2. Extraer una Clase y sus Métodos

```bash
libextract \
  -p ./mi-proyecto \
  -f ./mi-proyecto/src/models/User.ts \
  -s User \
  -o ./user-model
```

**Output:**
- Clase `User` completa
- Todos los tipos/interfaces que usa
- Utilidades importadas
- Dependencias externas

#### 3. Extraer Todos los Exports de un Módulo

```bash
libextract \
  -p ./mi-proyecto \
  -f ./mi-proyecto/src/utils/index.ts \
  -s "*" \
  -o ./utils-lib
```

**Output:**
- Todos los símbolos exportados en `index.ts`
- Dependencias transitivas de cada uno
- Estructura de carpetas preservada

#### 4. Trabajar con Path Aliases

Si tu `tsconfig.json` tiene:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "~/utils/*": ["src/utils/*"]
    }
  }
}
```

```bash
libextract \
  -p ./mi-proyecto \
  -f ./mi-proyecto/src/features/auth.ts \
  -s login \
  -o ./auth-module
```

`libextract` **automáticamente**:
- Resuelve `@/` y `~/` a rutas reales
- Convierte imports con aliases a relativos en el output
- Preserva solo dependencias reales

#### 5. Proyectos con TypeScript Project References

Si tienes un proyecto con múltiples `tsconfig`:

```
mi-proyecto/
├── tsconfig.json          # references: ["./tsconfig.app.json"]
├── tsconfig.app.json      # compilerOptions, paths
└── src/
```

```bash
libextract \
  -p ./mi-proyecto \
  -f ./mi-proyecto/src/app.ts \
  -s App \
  -o ./app-extracted
```

`libextract` **automáticamente**:
- Detecta las referencias de proyecto
- Carga todos los `tsconfig` referenciados
- Combina los `paths` de todos ellos
- Resuelve correctamente todos los imports

---

## 🎯 Casos de Uso

### 1. Crear Micro-Bibliotecas

**Escenario:** Tienes un proyecto monolítico con 500 utilidades, pero solo necesitas 10 para otro proyecto.

```bash
libextract -p ./monolith -f ./monolith/src/utils/index.ts -s "util1,util2,util3" -o ./micro-lib
cd ./micro-lib
npm publish
```

**Beneficio:** Bundle size reducido, solo las dependencias necesarias.

### 2. Migración de Código entre Proyectos

**Escenario:** Necesitas mover el módulo de autenticación de un proyecto legacy a uno nuevo.

```bash
libextract -p ./legacy-app -f ./legacy-app/src/auth/Auth.ts -s "*" -o ./new-app/src/auth
```

**Beneficio:** Migración limpia con todas las dependencias, sin copiar código innecesario.

### 3. Análisis de Dependencias

**Escenario:** Quieres saber qué dependencias externas realmente usa una feature específica.

```bash
libextract -p ./mi-app -f ./mi-app/src/features/payments.ts -s processPayment -o ./analysis
cat ./analysis/DEPENDENCIES.md
```

**Beneficio:** Reporte detallado mostrando:
- Dependencias externas (npm packages)
- Versiones
- Símbolos importados de cada una

### 4. Tree-Shaking Manual

**Escenario:** Tu bundler no elimina código muerto correctamente.

```bash
# Extraer solo lo que usas en producción
libextract -p ./app -f ./app/src/main.ts -s "*" -o ./prod-bundle
```

**Beneficio:** Control total sobre qué código incluir.

### 5. Code Review y Análisis de Impacto

**Escenario:** Antes de un PR grande, quieres ver el alcance real de los cambios.

```bash
libextract -p ./app -f ./app/src/services/ModifiedService.ts -s ModifiedClass -o ./review
```

**Beneficio:** Visualización de todos los archivos afectados directa o indirectamente.

---

## 📤 Output Generado

Cuando ejecutas `libextract`, genera los siguientes archivos:

### 1. Archivos de Código

```
output/
├── src/
│   ├── utils/
│   │   └── helper.ts       # Código extraído con imports correctos
│   └── types/
│       └── interfaces.ts
```

- **Estructura preservada:** Mantiene la jerarquía de directorios original
- **Imports corregidos:** Rutas relativas ajustadas al nuevo contexto
- **Path aliases resueltos:** Convertidos a rutas relativas

### 2. Manifiesto de Dependencias

#### Para Node.js / Bun:

**`package.json`**

```json
{
  "name": "extracted-code",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "axios": "^1.6.0",
    "lodash": "^4.17.21"
  }
}
```

#### Para Deno:

**`deno.json`**

```json
{
  "imports": {
    "axios": "npm:axios@^1.6.0"
  }
}
```

### 3. Reporte de Dependencias

**`DEPENDENCIES.md`**

```markdown
# Reporte de Dependencias Externas

Generado: 2025-01-15T10:30:00.000Z

Ambiente: nodejs

Total de dependencias: 2

## axios
- Versión: ^1.6.0
- Tipo: dependency
- Símbolos importados (3):
  - get
  - post
  - AxiosResponse
- Tipos de import: named

## lodash
- Versión: ^4.17.21
- Tipo: dependency
- Símbolos importados (2):
  - debounce
  - throttle
- Tipos de import: named
```

**Información incluida:**
- Fecha de generación
- Ambiente detectado (nodejs, deno, bun)
- Lista completa de dependencias externas
- Versión de cada paquete
- Símbolos específicos importados
- Tipo de dependencia (dependency vs devDependency)

---

## ⚙️ Requisitos y Compatibilidad

### Requisitos del Sistema

- **Node.js:** >= 18.0.0
- **TypeScript:** >= 5.0.0 (instalado en el proyecto a analizar)

### Tipos de Proyecto Soportados

| Tipo de Proyecto | Soporte | Notas |
|-----------------|---------|-------|
| TypeScript | ✅ Completo | Soporte nativo |
| JavaScript (con JSDoc) | ✅ Completo | Via TypeScript compiler |
| JavaScript puro | ⚠️ Parcial | Sin análisis de tipos |
| Node.js (CommonJS) | ✅ Completo | require/module.exports |
| Node.js (ESM) | ✅ Completo | import/export |
| Deno | ✅ Completo | Genera deno.json |
| Bun | ✅ Completo | Genera package.json |

### Características de TypeScript Soportadas

- ✅ Path aliases (`@/`, `~/`)
- ✅ Project References
- ✅ Decorators
- ✅ Generics
- ✅ Type assertions (`as`, `satisfies`)
- ✅ Namespace imports (`import * as`)
- ✅ Default exports
- ✅ Named exports
- ✅ Re-exports (`export * from`)
- ✅ Type-only imports (`import type`)

---

## 🐛 Solución de Problemas

### Error: "No se pudo encontrar 'tsconfig.json'"

**Causa:** El proyecto no tiene un `tsconfig.json` en la raíz.

**Solución:**
```bash
# Crear un tsconfig.json básico
cd tu-proyecto
tsc --init
```

### Error: "Symbol 'X' not found in file"

**Causa:** El símbolo no existe o no está exportado en el archivo especificado.

**Solución:**
1. Verifica que el símbolo esté exportado: `export function X() { ... }`
2. Verifica el nombre exacto (case-sensitive)
3. Para ver todos los exports: usa `-s "*"`

### Warning: "Identificadores usados sin import"

**Causa:** El código usa variables globales, built-ins, o propiedades de objetos.

**Impacto:** No es un error. Estos identificadores son:
- Globales de JavaScript (`console`, `setTimeout`)
- Propiedades de objetos (`obj.property`)
- Variables de ámbito local

**Acción:** Ninguna requerida, es informativo.

### Output: "No hay dependencias externas"

**Causa:** El código extraído no importa ningún paquete de `node_modules`.

**Impacto:** No se genera `package.json`.

**Acción:** Normal si solo usas código interno del proyecto.

### Path Aliases no se Resuelven

**Solución:**
1. Verifica que `tsconfig.json` tenga `compilerOptions.paths`
2. Verifica que `compilerOptions.baseUrl` esté definido
3. Si usas Project References, verifica que los paths estén en todos los tsconfig

Ejemplo correcto:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

---

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Por favor:

1. Fork el repositorio
2. Crea una rama para tu feature: `git checkout -b feature/nueva-feature`
3. Commit tus cambios: `git commit -am 'Add nueva feature'`
4. Push a la rama: `git push origin feature/nueva-feature`
5. Abre un Pull Request

**Para más detalles**, consulta [README_DEV.md](./README_DEV.md) para documentación completa de desarrollo.

### Reportar Bugs

Abre un issue en GitHub con:
- Descripción del problema
- Pasos para reproducir
- Output esperado vs actual
- Versión de Node.js, TypeScript, y sistema operativo

---

## 📄 Licencia

[ISC](https://opensource.org/licenses/ISC)

---

## 👏 Créditos

**@tirio/libextract** fue desarrollado con asistencia de IA ([Claude Code by Anthropic](https://claude.ai/code)).

### Inspiración

Proyectos relacionados que inspiraron este trabajo:
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [ts-morph](https://github.com/dsherret/ts-morph)
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)

---

## 🔗 Enlaces

- [Documentación para Desarrolladores](./README_DEV.md)
- [Changelog](./CHANGELOG.md)
- [NPM Package](https://www.npmjs.com/package/@tirio/libextract)
- [GitHub Repository](https://github.com/attirio/libextract)
- [Reportar Issues](https://github.com/attirio/libextract/issues)

---

**¿Preguntas? ¿Sugerencias?** Abre un issue en GitHub o contribuye al proyecto. ¡Gracias por usar @tirio/libextract! 🚀
