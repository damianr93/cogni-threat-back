#!/bin/bash

# Script de configuración para desarrollo
echo "🚀 Configurando Cogni-Threat para desarrollo..."

# Crear archivo .env si no existe
if [ ! -f .env ]; then
    echo "📝 Creando archivo .env desde env.example..."
    cp env.example .env
    echo "✅ Archivo .env creado. Por favor, edita las variables según necesites."
else
    echo "✅ Archivo .env ya existe."
fi

# Instalar dependencias
echo "📦 Instalando dependencias..."
pnpm install

# Generar cliente de Prisma
echo "🗄️ Generando cliente de Prisma..."
pnpm run db:generate

echo "✅ Configuración completada!"
echo ""
echo "Para continuar:"
echo "1. Edita el archivo .env con tus valores reales"
echo "2. Levanta la base de datos: docker compose up -d postgres"
echo "3. Ejecuta las migraciones: pnpm run db:push"
echo "4. Inicia la API: pnpm run start:dev"

