@echo off
set "JAVA_HOME=%~dp0jdk21\jdk-21.0.11+10"
if not exist "%JAVA_HOME%" (
    set "JAVA_HOME=%~dp0.jdk21\jdk-21.0.11+10"
)
set "PATH=%JAVA_HOME%\bin;%PATH%"
mvn %*
