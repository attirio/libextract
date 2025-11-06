// test-project/src/types.ts

export interface User {
    id: number;
    name: string;
}

export type UserRole = 'admin' | 'user';

// Un tipo no utilizado, para verificar que no se incluya
export type UnusedType = string | number;
