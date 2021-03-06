import { AppOptions } from './options/app.option';
import { Settings } from './util/Settings';
import { View } from "./components/View";
import { ModelAndView } from "./components/ModelAndView";
import { AuthenticatedMiddleware } from "./middleware/AuthenticatedMiddleware";
import { ComponentTree } from "./params/ComponentTree";
import express, { Application, json, NextFunction, Request, Response, Router, urlencoded } from "express";
import session from 'express-session';
import fs from "fs";
import path from "path";
import crayon from "crayon.js";
import cookieParser from "cookie-parser";
import util from "util";
import { ResponseType } from "./decorators/types/responsetype";
import { Methods } from "./decorators/types/method";
import {executeMiddleware, extractMethodParameters} from "./util/util"
export class Volcry {
  private port: string | number;
  private app: Application;
  private baseScan: string;
  private router: Router = express.Router();
  private settings : Settings = new Settings()

  constructor(options : AppOptions) {
    this.port = options.port
    this.app = express();
    this.baseScan = options.base_scan;
  }

  start(): Application {
    this.scanComponents(this.baseScan);
    this.app.set("view engine", "pug");
    this.app.set("views", `${this.baseScan}/resources`);
    this.bootstrap();
    this.app.listen(this.port, () => {
      console.log(`Server started on port ${this.port}`);
    });

    return this.app;
  }

  private bootstrap(): void {
    console.log(crayon.greenYellow("Bootstraping"));

    // console.log(util.inspect(ComponentTree.components,  false, null, true))
    Object.entries<any>(ComponentTree.components).forEach(([index, item]) => {
      let base_url = item.base_url;
      Object.entries<any>(item.methods).forEach(([index_, element]) => {
        let url: string = base_url != null && base_url != undefined ? base_url + "/" + element.url : element.url;

        url = url.replace(/\/$/, "");
        // console.log(`URL ${url}`)

        switch (element.method) {
          case Methods.GET:
            this.createGetRoute(item.constructor, element, url);
            break;
          case Methods.POST:
            this.createPostRoute(item.constructor, element, url);
            break;
          case Methods.PUT:
            this.createPutRoute(item.constructor, element, url);
            break;
        }
      });
    });

    this.app.use(cookieParser());
    this.app.use(json())
    this.app.use(urlencoded({extended : true}))
    this.app.use(
      session({
        secret: "somerandonstuffs",
        resave: false,
        saveUninitialized: false,
        cookie: {
          expires: new Date("22-03-2022"),
        },
      })
    );
    this.app.use("/", this.router);
    console.log("Done Bootstraping");
  }

  private serveRequest(constructor: Function, properties: any, request: Request, response: Response, next : NextFunction): void {
    let parameter_count = properties.parameter_count;
    let return_value = null;
    if(properties.middleware){
      executeMiddleware(properties.middleware, request, response, next)
    }
    let action_class_object = Reflect.construct(constructor, []);

    Reflect.set(action_class_object, "request", request);

    if (parameter_count > 0) {
      let paramList = extractMethodParameters(properties.params, request);
      return_value = properties.action.apply(action_class_object, paramList);
    } else {
      return_value = action_class_object[properties.name]();
    }
    request = Reflect.get(action_class_object, "request");
    this.handleResponse(return_value, response, properties);
  }

  private handleResponse(return_value: any, response: Response, controller_action: any) {
    if (controller_action.response_type === ResponseType.JSON && return_value !== undefined) {
      response.json(return_value);
      return;
    }
    if (return_value instanceof ModelAndView) {
      const view = View.findView(return_value.getTemplateName());
      response.render(view, return_value.getAttributes());
      return;
    }
    if (typeof return_value === "string") {
      if (return_value.startsWith(":")) {
        let redirect_route = return_value.substr(1);
        response.redirect(redirect_route);
        return;
      }
      const view = View.findView(return_value.toString());
      response.render(view);
      return;
    }
    response.send(return_value);
  }

  private scanComponents(baseRoute: string) {
    baseRoute = path.resolve(baseRoute);
    let files = fs.readdirSync(baseRoute);
    for (let file of files) {
      let br = path.join(path.resolve(baseRoute), "/", file);
      let stat = fs.statSync(path.resolve(br));
      if (stat.isFile() && file.toLowerCase().indexOf("controller") > -1) {
        require(br);
      }
      if (stat.isDirectory()) {
        this.scanComponents(path.join(baseRoute, "/", file));
      }
    }
  }

  private authenticated(authenticated: boolean, request: Request, response: Response, next: NextFunction) {
    if (authenticated) {
      executeMiddleware(AuthenticatedMiddleware, request, response, next)
    } else {
      next();
    }
  }

  private createGetRoute(constructor: Function, properties: any, url: string) {
    this.router.get(`/${url}`, (request, response, next) => {
        this.authenticated(properties.authenticated, request, response, next);
      },
      (request, response, next) => {
        this.serveRequest(constructor, properties, request, response, next);
      }
    );
  }

  private createPostRoute(constructor: Function, properties: any, url: string) {
    this.router.post(`/${url}`,(request, response, next) => {
        this.authenticated(properties.authenticated, request, response, next);
      },
      (request, response, next) => {
        this.serveRequest(constructor, properties, request, response, next);
      }
    );
  }

  private createPutRoute(constructor: Function, properties: any, url: string) {
    this.router.put(
      `/${url}`,
      (request, response, next) => {
        this.authenticated(properties.authenticated, request, response, next);
      },
      (request, response, next) => {
        this.serveRequest(constructor, properties, request, response, next);
      }
    );
  }
}
