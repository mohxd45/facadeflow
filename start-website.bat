@echo off
cd /d "%~dp0"

echo.
echo Facade Takeoff local website is starting...
echo Open http://localhost:3000 in your browser
echo.
echo Press Ctrl+C to stop the server.
echo.

npm.cmd run dev

echo.
echo The development server has stopped.
pause
