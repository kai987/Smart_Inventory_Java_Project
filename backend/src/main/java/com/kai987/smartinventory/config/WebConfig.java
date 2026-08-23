package com.kai987.smartinventory.config;

import java.io.IOException;

import org.springframework.core.io.Resource;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new SpaPathResourceResolver());
    }

    private static final class SpaPathResourceResolver extends PathResourceResolver {
        @Override
        protected Resource getResource(String resourcePath, Resource location) throws IOException {
            if (!resourcePath.isEmpty()) {
                Resource requested = location.createRelative(resourcePath);
                if (requested.exists() && requested.isReadable()
                        && checkResource(requested, location)) {
                    return requested;
                }
            }

            boolean apiPath = resourcePath.equals("api") || resourcePath.startsWith("api/");
            String lastSegment = resourcePath.substring(resourcePath.lastIndexOf('/') + 1);
            if (!apiPath && !lastSegment.contains(".")) {
                Resource index = location.createRelative("index.html");
                return index.exists() && index.isReadable() ? index : null;
            }
            return null;
        }
    }
}
