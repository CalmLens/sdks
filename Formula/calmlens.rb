class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.27.5"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.5/calmlens-0.27.5-darwin-arm64.tar.gz"
      sha256 "29a531bbb9c95edcaced80782a9edeb6cc63bd65bc662da160c26d7f87487abf"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.5/calmlens-0.27.5-darwin-x64.tar.gz"
      sha256 "5648a4a79d68e75deb724868d738df4916842fc6c5c685e9a62dab2f3efe7d50"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.5/calmlens-0.27.5-linux-arm64.tar.gz"
      sha256 "077c9e6533608d598321ba6da753f3c6582769f307eba7daef662425b3d713f7"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.5/calmlens-0.27.5-linux-x64.tar.gz"
      sha256 "b991955168aee873eb8664462cfca43a69766cddd6d9ae69496fa23abaabda2d"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
