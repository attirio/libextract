TS Slicer

Esta es una herramienta CLI que utiliza la API del Compilador de TypeScript para realizar "slicing" (rebanado) de código.

Dado un proyecto, un archivo y un símbolo, la herramienta encontrará ese símbolo y rastreará recursivamente todas sus dependencias (funciones, clases, tipos, constantes, etc.) dentro de ese proyecto, imprimiendo el código fuente de todo lo necesario.

Configuración y Ejecución

Para que este script funcione, necesitas dos cosas:

La propia herramienta CLI (los archivos package.json, tsconfig.json y slicer.ts).

Un proyecto TypeScript de ejemplo sobre el cual ejecutarla.

He incluido un proyecto de ejemplo llamado test-project.

1. Estructura de Archivos

Crea la siguiente estructura de carpetas y archivos. Copia el contenido de cada bloque de código en el archivo correspondiente.

/tu-proyecto-slicer/
├── package.json
├── tsconfig.json
├── slicer.ts
├── README.md
│
└── /test-project/
    ├── tsconfig.json
    ├── /src/
        ├── types.ts
        ├── utils.ts
        └── main.ts


2. Instalar Dependencias

Navega a la carpeta /tu-proyecto-slicer/ y ejecuta:

npm install


3. Ejecutar el Slicer

Una vez instaladas las dependencias, simplemente ejecuta el script start que he configurado en package.json:

npm start


Este comando está preconfigurado para ejecutar el slicer sobre el test-project, buscando el símbolo mainFunction.

4. Salida de Ejemplo

Verás una salida en tu consola que muestra todo el código del que mainFunction depende, agrupado por archivo:

--- Slicing completo para el símbolo: mainFunction ---

//==================================================
// Archivo: test-project/src/types.ts
//==================================================

export interface User { id: number; name: string; }

//--------------------------------------------------

export type UserRole = 'admin' | 'user';

//--------------------------------------------------

//==================================================
// Archivo: test-project/src/utils.ts
//==================================================

const BASE_URL = "[https://api.example.com](https://api.example.com)";

//--------------------------------------------------

export function getUserApi(id: number): string { return `${BASE_URL}/users/${id}`; }

//--------------------------------------------------

//==================================================
// Archivo: test-project/src/main.ts
//==================================================

export function mainFunction(user: User): { url: string; role: UserRole } {
    const url = getUserApi(user.id);
    localHelper(url);
    const role: UserRole = 'admin';
    return { url, role };
}

//--------------------------------------------------


5. Probar con otros símbolos

Puedes editar el comando start en package.json o ejecutarlo manualmente para apuntar a otros símbolos.

Por ejemplo, para analizar solo getUserApi de utils.ts:

ts-node slicer.ts ./test-project ./test-project/src/utils.ts getUserApi
