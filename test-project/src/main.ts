// test-project/src/main.ts
import { User, UserRole } from './types';
import { getUserApi } from './utils';

// Una función helper a nivel de módulo (no exportada)
// SÍ se incluye porque es una dependencia real de mainFunction
function localHelper(value: string) {
    console.log("Local:", value);
}

// El símbolo que vamos a rastrear
export function mainFunction(user: User): { url: string; role: UserRole } {
    const url = getUserApi(user.id);
    localHelper(url); // Uso de una función local
    const role: UserRole = 'admin';
    return { url, role };
}

// Otra función no utilizada
export function anotherUnusedFunction() {
    console.log("No me deben incluir");
}
