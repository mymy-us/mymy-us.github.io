@echo off
:: This command ensures the terminal looks at the folder this file is inside
cd /d "%~dp0"

echo ========================================================
echo  STARTING YOUR BLOG...
echo  Open your browser to: http://localhost:4000
echo ========================================================


:: This runs the server
bundle exec jekyll serve

:: This keeps the window open if the server crashes so you can read the error
pause