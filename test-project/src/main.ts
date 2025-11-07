// test-project/src/main.ts
import { DecoupledPromise } from './DecoupledPromise';
import { User, UserRole } from './types';
import { getUserApi } from './utils';

// Una función helper a nivel de módulo (no exportada)
// SÍ se incluye porque es una dependencia real de mainFunction
function localHelper(value: string) {
    console.log("Local:", value);
}

// El símbolo que vamos a rastrear
export async function mainFunction(user: User): Promise< { url: string; role: UserRole } > {
    const url = getUserApi(user.id);
    const { fine, promise } = new DecoupledPromise< { url: string; role: UserRole } >()
    localHelper(url); // Uso de una función local
    const role: UserRole = 'admin';
    fine( { url, role } );
    return promise
}

// Otra función no utilizada
export function anotherUnusedFunction() {
    console.log("No me deben incluir");
}
