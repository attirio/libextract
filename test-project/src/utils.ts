// test-project/src/utils.ts
import { User } from './types'; // Dependencia de tipos

// Una dependencia de constante
const BASE_URL = "https://api.example.com";

// Una dependencia de función (que depende de la constante)
export function getUserApi(id: number): string {
    return `${BASE_URL}/users/${id}`;
}

// Una función no utilizada, para verificar que no se incluya
export function isEmail(email: string): boolean {
    return email.includes('@');
}
