import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import type { useProductImageDraft } from './useProductImageDraft'
import styles from '../admin/admin.module.css'

export function ProductImageField({
  id,
  image,
  disabled,
}: {
  id: string
  image: ReturnType<typeof useProductImageDraft>
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className={styles.imageField}>
      <Field
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        label={t('admin.productImage')}
        hint={t('admin.productImageHint')}
        error={image.errorKey === null ? undefined : t(image.errorKey)}
        disabled={disabled}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0]
          if (selected !== undefined) image.selectFile(selected)
          event.currentTarget.value = ''
        }}
      />
      {image.previewUrl === null ? <p className={styles.noImage}>{t('admin.noProductImage')}</p> : (
        <div className={styles.imagePreview}>
          <img src={image.previewUrl} alt={t('admin.productImagePreview')} width="240" height="180" />
          <Button type="button" variant="secondary" size="small" disabled={disabled} onClick={image.remove}>{t('admin.removeProductImage')}</Button>
        </div>
      )}
      {image.previewUrl === null && image.errorKey !== null ? <Button type="button" variant="ghost" size="small" disabled={disabled} onClick={image.remove}>{t('admin.removeProductImage')}</Button> : null}
    </div>
  )
}
