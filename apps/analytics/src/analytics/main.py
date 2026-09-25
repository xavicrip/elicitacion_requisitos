from fastapi import FastAPI


def create_app() -> FastAPI:
    return FastAPI(title="ReqCanvas analytics")


app = create_app()
