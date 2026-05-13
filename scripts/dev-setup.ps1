# Script de configuración para desarrollo en Windows
Write-Host "🚀 Configurando Cogni-Threat para desarrollo..." -ForegroundColor Green

# Crear archivo .env si no existe
if (-not (Test-Path ".env")) {
    Write-Host "📝 Creando archivo .env desde env.example..." -ForegroundColor Yellow
    Copy-Item "env.example" ".env"
    Write-Host "✅ Archivo .env creado. Por favor, edita las variables según necesites." -ForegroundColor Green
} else {
    Write-Host "✅ Archivo .env ya existe." -ForegroundColor Green
}

# Instalar dependencias
Write-Host "📦 Instalando dependencias..." -ForegroundColor Yellow
npm install

# Generar cliente de Prisma
Write-Host "🗄️ Generando cliente de Prisma..." -ForegroundColor Yellow
npm run db:generate

Write-Host "✅ Configuración completada!" -ForegroundColor Green
Write-Host ""
Write-Host "Para continuar:" -ForegroundColor Cyan
Write-Host "1. Edita el archivo .env con tus valores reales" -ForegroundColor White
Write-Host "2. Levanta la base de datos: docker compose up -d postgres" -ForegroundColor White
Write-Host "3. Ejecuta las migraciones: npm run db:push" -ForegroundColor White
Write-Host "4. Inicia la API: npm run start:dev" -ForegroundColor White

