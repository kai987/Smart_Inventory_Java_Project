@ECHO OFF
SETLOCAL
SET BASE_DIR=%~dp0
SET WRAPPER_JAR=%BASE_DIR%.mvn\wrapper\maven-wrapper.jar
IF NOT EXIST "%WRAPPER_JAR%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/3.3.4/maven-wrapper-3.3.4.jar' -OutFile '%WRAPPER_JAR%'"
)
java %MAVEN_OPTS% -classpath "%WRAPPER_JAR%" "-Dmaven.multiModuleProjectDirectory=%BASE_DIR%" org.apache.maven.wrapper.MavenWrapperMain %*
ENDLOCAL
