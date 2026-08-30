import numpy as np
import torch
from ..utils.load_model import load_model


class Decoder:
    def __init__(self, model_path, device="cuda"):
        kwargs = {
            "module_name": "SPADEDecoder",
        }
        self.model, self.model_type = load_model(model_path, device=device, **kwargs)
        self.device = device
        self._logged_output_stats = False
        
    def __call__(self, feature):

        if self.model_type == "onnx":
            pred = self.model.run(None, {"feature": feature})[0]
        elif self.model_type == "tensorrt":
            self.model.setup({"feature": feature})
            self.model.infer()
            pred = self.model.buffer["output"][0].copy()
        elif self.model_type == 'pytorch':
            # FP16 autocast produces an all-NaN image on GTX 1660 Ti (Turing)
            # with the supported torch 2.0/cu118 runtime. Decode in FP32 so the
            # multipart stream contains real face pixels instead of a black crop.
            with torch.no_grad():
                pred = self.model(torch.from_numpy(feature).to(self.device)).float().cpu().numpy()
        else:
            raise ValueError(f"Unsupported model type: {self.model_type}")

        if not self._logged_output_stats:
            finite = np.isfinite(pred)
            print(
                "[decoder] raw output "
                f"shape={pred.shape} finite={float(finite.mean()):.4f} "
                f"min={float(np.nanmin(pred)):.6f} max={float(np.nanmax(pred)):.6f} "
                f"mean={float(np.nanmean(pred)):.6f}",
                flush=True,
            )
            self._logged_output_stats = True
        
        pred = np.transpose(pred[0], [1, 2, 0]).clip(0, 1) * 255    # [h, w, c]
        
        return pred
