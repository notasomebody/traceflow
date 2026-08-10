package com.traceflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@SpringBootApplication
public class TraceflowBackendApplication {

	public static void main(String[] args) {
		prepareDataDirectory();
		SpringApplication.run(TraceflowBackendApplication.class, args);
	}

	private static void prepareDataDirectory() {
		String configured = System.getenv("TRACEFLOW_DATA_DIR");
		Path directory = configured == null || configured.isBlank()
				? Path.of(System.getProperty("user.home"), ".traceflow")
				: Path.of(configured);
		try {
			Files.createDirectories(directory);
			System.setProperty("traceflow.db-path", directory.resolve("traceflow.db").toString());
		} catch (IOException exception) {
			throw new IllegalStateException("无法创建迹汇本地数据目录: " + directory, exception);
		}
	}

}
